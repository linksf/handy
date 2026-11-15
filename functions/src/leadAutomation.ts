import {renderBriefHtml} from "./dailyBriefEmail";
/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret, defineString} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import {Assessment, appointmentBody, calendarBlockReason, LeadMessage, OWNER_EMAIL, pacificDate, TIME_ZONE} from "./leadAutomationCore";
import {analyzeConversation, CalendarApi, CalendarState, sendBrief, workspaceAccessToken} from "./leadAutomationGoogle";
import {chooseDuration, Event, historyForLead, recordedVisits, reconcileTravel} from "./leadAutomationScheduling";
import {promoteLead, refreshJobScope} from "./leadWorkflow";
import {notificationPlans} from "./leadNotifications";
import {THREADS} from "./leadAutomationStore";

const mode = defineString("LEAD_AUTOMATION_MODE", {default: "off"});
const model = defineString("LEAD_AUTOMATION_MODEL", {default: "gemini-3.8-flash"});
const calendarId = defineString("LEAD_AUTOMATION_CALENDAR_ID", {default: OWNER_EMAIL});
const googleOAuth = defineSecret("LEAD_AUTOMATION_GOOGLE_OAUTH");

function database(): admin.firestore.Firestore {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}
function failureCode(error: unknown): string {
  // Allowlist local error codes only; provider/validation errors can contain personal data.
  const message = error instanceof Error ? error.message : "";
  return /^[a-z][a-z0-9_]{0,159}$/.test(message) ? message : "processing_failed";
}

export function conversationHealth(threads: Record<string, unknown>[]): {status: string; lastError: string | null; failedConversations: number; pendingConversations: number} {
  const pending = threads.filter((d) => d.dirty);
  const failed = pending.filter((d) => d.lastError);
  const billing = failed.some((d) => String(d.lastError).includes("billing_disabled"));
  return {status: failed.length ? "degraded" : pending.length ? "processing" : "healthy",
    lastError: billing ? "cloud_billing_disabled" : failed.length ? "conversation_processing_failed" : null,
    failedConversations: failed.length, pendingConversations: pending.length};
}

async function processConversation(db: admin.firestore.Firestore, ref: admin.firestore.DocumentReference, calendar: CalendarApi | null): Promise<void> {
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!data?.dirty) return;
  const version = Number(data.version);
  try {
    if (!data.lead) throw new Error("initial_lead_missing");
    const events = await ref.collection("events").where("kind", "==", "message").get();
    const messages = events.docs.map((d) => d.data() as LeadMessage)
      .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id.localeCompare(b.id));
    if (messages.length > 500 || JSON.stringify(messages).length > 300000) throw new Error("conversation_too_large_review_required");
    const lead = {...data.lead};
    // Older captured leads omitted parsed hours; recover them from the imported job.
    if (!lead.initialEstimate?.hours && lead.jobId) {
      const job = await db.doc(`jobs/${lead.jobId}`).get();
      lead.initialEstimate = {...lead.initialEstimate, hours: job.get("hours") || ""};
    }
    const cached = data.assessedVersion === version && data.assessmentPolicy === 5 && data.assessment;
    let history: Event[] = data.durationHistory || [];
    if (!cached) {
      if (calendar) {
        try {
          history = historyForLead(await calendar.list(new Date(Date.now() - 180 * 86400000).toISOString(), new Date().toISOString()), lead, Date.now());
        } catch {
          history = data.durationHistory || [];
        }
      }
      if (lead.jobId) {
        const sessions = await db.collection(`jobs/${lead.jobId}/workSessions`).where("startMs", ">=", Date.now() - 180 * 86400000).orderBy("startMs", "desc").limit(500).get();
        history.push(...recordedVisits(sessions.docs.map((d) => d.data()), lead, Date.now()));
        // Mutable job.hours can include cumulative billing, so it is not a per-visit estimate after work starts.
        if (!sessions.empty && !data.lead.initialEstimate?.hours) lead.initialEstimate.hours = "";
      }
    }
    const rawAssessment: Assessment = cached ? data.assessment : await analyzeConversation(
      process.env.GCLOUD_PROJECT || "", model.value(), {
        lead, currentTime: new Date().toISOString(), timeZone: TIME_ZONE,
        previousCalendarAppointment: data.calendar || null, historicalAppointments: history,
        taskLibrary: (await db.collection("tasks").get()).docs.map((d) => ({id: d.id, name: d.get("name")})),
      }, messages,
    );
    const assessment = structuredClone(rawAssessment);
    const appt = assessment.appointment;
    if (lead.historicalMessagesMissing && !assessment.needsReview.includes("Historical conversation messages need to be imported.")) assessment.needsReview.push("Historical conversation messages need to be imported.");
    let booking = null;
    if (appt.status === "confirmed" && appt.start) {
      let nearby: Event[] = [];
      if (calendar) {
        try {
          nearby = await calendar.list(appt.start, new Date(Date.parse(appt.start) + 25 * 3600000).toISOString());
        } catch {
          assessment.importantDetails.push("Calendar availability could not be checked; conflicts require verification after synchronization recovers.");
        }
      }
      booking = chooseDuration(assessment, history, nearby, data.calendar?.eventId, data.leadId);
      appt.end = new Date(Date.parse(appt.start) + booking.minutes * 60000).toISOString();
      assessment.importantDetails.push(`Calendar reservation: ${booking.minutes} minutes. ${booking.basis}.`);
      if (!assessment.address) assessment.importantDetails.push("Job address pending; travel reserved at 30 minutes each way.");
    }
    let review = calendarBlockReason(assessment, new Date());
    // Save the interpreted facts even when calendar sync later fails; daily brief can show the failure.
    const current = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (Number(fresh.get("version")) !== version) return false;
      tx.update(ref, {assessment: rawAssessment, booking, durationHistory: history, assessmentPolicy: 5, assessedVersion: version, assessedAt: admin.firestore.FieldValue.serverTimestamp()});
      return true;
    });
    if (!current) return;
    const canonical = await db.doc(`leads/${data.leadId}`).get();
    let promoted: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    const leadFirstEnabled = (await db.doc("leadAutomationState/leadWorkflow").get()).get("enabled");
    if (!review && canonical.exists && calendar && leadFirstEnabled) promoted = await promoteLead(db, data.leadId, assessment, booking, null, version);
    if (canonical.exists && canonical.get("jobId") && leadFirstEnabled && !promoted) await refreshJobScope(db, data.leadId, assessment, version);
    if (canonical.exists) {
      await canonical.ref.set({lastError: null, assessment: rawAssessment, followUp: assessment.followUp, schedulingReview: review, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(!canonical.get("jobId") && ["lost", "cancelled"].includes(assessment.stage) ? {status: "lost"} : {})}, {merge: true});
    }
    let calendarState = data.calendar as CalendarState | null || null;
    if (!review && calendar) {
      const fresh = await ref.get();
      if (Number(fresh.get("version")) !== version) return;
      calendarState = await calendar.synchronize(data.leadId, appt.status === "cancelled" ? {} : appointmentBody(assessment, data.leadId),
        calendarState, String(version), appt.kind, appt.status === "cancelled", true);
    } else if (!review && !calendar) {
      review = "Observation mode: calendar changes are disabled.";
    }
    if (promoted?.jobId && calendarState) {
      const jobRef = db.doc(`jobs/${promoted.jobId}`);
      await db.runTransaction(async (tx) => {
        const job = await tx.get(jobRef);
        tx.update(jobRef, {calendarSyncStatus: "synced", calendarSyncError: null, visits: (job.get("visits") || []).map((v: {id: string}) => v.id === promoted?.visitId ? {...v, calendarEventId: calendarState?.eventId} : v)});
      });
    }
    const noticeConfig = await db.doc("leadAutomationState/telegram").get();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      const sameVersion = Number(fresh.get("version")) === version;
      const calendarStatus = review ? "needs_review" : calendarState ? (appt.status === "cancelled" ? "cancelled" : "booked") : "not_booked";
      if (noticeConfig.get("enabled")) {
        const notificationContext = messages.slice(-3).map((m) => `${new Date(m.sentAt).toLocaleString("en-US", {timeZone: TIME_ZONE})} Pacific — ${m.sender}: ${m.text.slice(0, 350)}`).join("\n");
        const plans = notificationPlans(ref.id, fresh.data() || {}, {assessment, booking, calendar: calendarState, calendarStatus, processedVersion: version, notificationContext}, Date.now()).filter((p) => sameVersion || p.kind === "booking");
        for (const plan of plans) tx.set(db.doc(`leadNotifications/${plan.id}`), {...plan, status: "pending", createdAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
        const question = plans.find((p) => p.kind === "clarification");
        if (question) tx.update(ref, {notificationQuestionKey: question.questionKey});
      }
      tx.update(ref, {
        // Preserve completed external-action state even if another message arrived during the API call.
        calendar: calendarState, calendarReview: review, calendarStatus, processedVersion: version,
        lastError: null, attempts: 0,
        ...(sameVersion ? {dirty: false, nextAttemptAt: admin.firestore.FieldValue.delete()} : {}),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    const code = failureCode(error);
    const canonical = await db.doc(`leads/${data.leadId}`).get();
    if (canonical.exists) {
      await canonical.ref.set({lastError: code}, {merge: true});
      if (canonical.get("jobId")) await db.doc(`jobs/${canonical.get("jobId")}`).set({calendarSyncStatus: "failed", calendarSyncError: code}, {merge: true});
    }
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (Number(fresh.get("version")) !== version) return;
      const attempts = Number(fresh.get("attempts") || 0) + 1;
      tx.update(ref, {lastError: code, attempts, nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + Math.min(360, 5 * 2 ** Math.min(attempts, 7)) * 60000)});
    });
    logger.error("Lead automation could not process conversation", {conversationId: ref.id, code});
  }
}

/** One shared lease serializes calendar conflict checks across all leads and scheduler retries. */
export const processThumbtackConversations = onSchedule({
  schedule: "every 5 minutes", timeZone: TIME_ZONE, timeoutSeconds: 540,
  maxInstances: 1, concurrency: 1, secrets: [googleOAuth], retryCount: 0,
}, async () => {
  if (!["observe", "live"].includes(mode.value())) return;
  const db = database();
  const lock = db.doc("leadAutomationState/worker");
  const owner = randomUUID();
  const acquired = await db.runTransaction(async (tx) => {
    const current = await tx.get(lock);
    if (Number(current.get("leaseUntil") || 0) > Date.now()) return false;
    tx.set(lock, {owner, leaseUntil: Date.now() + 11 * 60000}, {merge: true});
    return true;
  });
  if (!acquired) return;
  try {
    const pending = await db.collection(THREADS).where("nextAttemptAt", "<=", admin.firestore.Timestamp.now()).orderBy("nextAttemptAt").limit(5).get();
    const token = mode.value() === "live" ? await workspaceAccessToken(googleOAuth.value()) : "";
    const calendar = token ? new CalendarApi(token, calendarId.value()) : null;
    const deadline = Date.now() + 4 * 60000;
    for (const item of pending.docs) {
      if (Date.now() > deadline) break;
      await processConversation(db, item.ref, calendar);
    }
    const threads = await db.collection(THREADS).get();
    if (calendar) {
      const latestEnd = Math.max(Date.now() + 30 * 86400000, ...threads.docs.map((d) => Date.parse(d.get("calendar.end") || "") || 0));
      await reconcileTravel(db, calendar, token, new Date(latestEnd + 86400000).toISOString());
    }
    const health = conversationHealth(threads.docs.map((d) => d.data()));
    await lock.set({...health, lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(health.status === "healthy" ? {lastSuccessAt: admin.firestore.FieldValue.serverTimestamp()} : {}),
    }, {merge: true});
  } catch (error) {
    await lock.set({status: "degraded", lastError: failureCode(error), failedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    logger.error("Lead automation worker failed", {code: failureCode(error)});
  } finally {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(lock);
      if (current.get("owner") === owner) tx.update(lock, {leaseUntil: 0});
    });
  }
});

export function renderBrief(now: Date, events: Record<string, unknown>[], threads: Record<string, unknown>[], warnings: string[]): string {
  const when = (value: unknown): string => {
    const v = value as {dateTime?: string; date?: string};
    return v?.dateTime ? new Date(v.dateTime).toLocaleString("en-US", {timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : `${v?.date || "Date unknown"} (all day)`;
  };
  const lines = [`Omnificology daily brief — ${pacificDate(now)}`, "Times are Pacific.", "", "UPCOMING — NEXT 7 DAYS"];
  const visible = events.filter((e) => e.status !== "cancelled" && !String(e.summary).startsWith("Cancelled — "));
  if (!visible.length) lines.push(warnings.length ? "Calendar availability could not be verified; see attention items." : "No upcoming appointments on the selected calendar.");
  for (const event of visible) {
    lines.push(`\n${when(event.start)} — ${String(event.summary || "Untitled appointment")}`);
    if (event.location) lines.push(`Address: ${String(event.location)}`);
    if (event.description) lines.push(String(event.description));
    if (event.htmlLink) lines.push(String(event.htmlLink));
  }
  const followUps: string[] = [];
  const attention = [...warnings];
  for (const item of threads) {
    const a = item.assessment as Assessment | undefined;
    const lead = item.lead as {name?: string} | undefined;
    const label = a?.clientName || lead?.name || `Lead ${item.leadId}`;
    if (item.lastError) attention.push(`${label}: ${String(item.lastError).replace(/_/g, " ")}`);
    if (item.dirty || item.assessedVersion !== item.version) {
      attention.push(`${label}: new information is waiting to be processed.`);
      continue; // Do not present old follow-up advice as current.
    }
    if (!a) continue;
    const follow = a.followUp;
    if (follow.owner !== "none") {
      const due = follow.dueAt ? Date.parse(follow.dueAt) : null;
      const updatedAt = item.updatedAt as {toMillis?: () => number} | undefined;
      const waitingLongEnough = now.getTime() - (updatedAt?.toMillis?.() || now.getTime()) >= 48 * 3600000;
      if ((due !== null && due <= now.getTime() + 24 * 3600000) ||
          (due === null && (follow.owner === "business" || waitingLongEnough))) {
        followUps.push(`${label} — ${follow.owner === "business" ? "Your follow-up" : "Waiting on client"}: ${follow.reason}${due !== null ? ` (due ${when({dateTime: follow.dueAt})})` : ""}\n${a.jobSummary}`);
      }
    }
    attention.push(...a.needsReview.map((issue) => `${label}: ${issue}`));
    if (item.calendarReview && !["completed", "lost"].includes(a.stage) && ["confirmed", "cancelled"].includes(a.appointment.status)) attention.push(`${label}: ${String(item.calendarReview)}`);
  }
  lines.push("", "FOLLOW-UPS", ...(followUps.length ? followUps : ["No follow-ups flagged from the captured conversations."]), "", "NEEDS ATTENTION", ...([...new Set(attention)].length ? [...new Set(attention)] : ["Nothing flagged."]));
  lines.push("", "Based on captured Thumbtack conversations and the selected Google Calendar. Conversations from before message capture began may be incomplete.");
  return lines.join("\n");
}

export const emailDailyLeadBrief = onSchedule({
  schedule: "0 8 * * *", timeZone: TIME_ZONE, timeoutSeconds: 300,
  maxInstances: 1, concurrency: 1, secrets: [googleOAuth], retryCount: 0,
}, async () => {
  if (mode.value() !== "live") return;
  const db = database();
  const now = new Date();
  const date = pacificDate(now);
  const run = db.doc(`leadAutomationBriefs/${date}`);
  const existing = await run.get();
  if (["sending", "sent", "delivery_unknown"].includes(String(existing.get("status")))) return;
  try {
    const token = await workspaceAccessToken(googleOAuth.value());
    const warnings: string[] = [];
    const telegram = await db.doc("leadAutomationState/telegram").get();
    if (telegram.get("enabled") && telegram.get("lastError")) warnings.push(`Telegram notifications: ${String(telegram.get("lastError")).replace(/_/g, " ")}. Check undelivered alerts.`);
    const contacts = await db.doc("leadAutomationState/contacts").get();
    if (contacts.get("enabled") && contacts.get("lastError")) warnings.push(`Google Contacts sync: ${String(contacts.get("lastError")).replace(/_/g, " ")}. New lead contacts may be missing.`);
    const worker = await db.doc("leadAutomationState/worker").get();
    if (worker.get("lastError")) warnings.push(`Automation worker: ${String(worker.get("lastError")).replace(/_/g, " ")}`);
    if (worker.get("failedConversations")) warnings.push(`${worker.get("failedConversations")} conversations failed processing; calendar bookings may be missing.`);
    if (String(worker.get("lastError") || "").includes("billing_disabled")) warnings.push("Google Cloud billing is disabled. Restore the project's billing account to resume AI analysis and calendar automation.");
    let events: Record<string, unknown>[] = [];
    try {
      events = await new CalendarApi(token, calendarId.value()).list(now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString());
    } catch {
      warnings.push("Calendar could not be read. Upcoming appointments are not verified.");
    }
    // Read all conversation records: an older unresolved promise must not disappear from the brief.
    const threads = await db.collection(THREADS).get();
    const alertFailures = await db.collection("leadAutomationConflictAlerts").where("status", "in", ["sending", "delivery_unknown"]).get();
    if (!alertFailures.empty) warnings.push(`${alertFailures.size} conflict notification(s) have unconfirmed email delivery. Check calendar overlaps.`);
    const priorFailures = await db.collection("leadAutomationBriefs").where("status", "in", ["failed", "delivery_unknown", "sending"]).get();
    for (const failure of priorFailures.docs) if (failure.id !== date) warnings.push(`Brief for ${failure.id}: ${failure.get("status")}. Check delivery before retrying.`);
    const researchFailures = await db.collection("equipmentResearch").where("status", "==", "unavailable").get();
    if (!researchFailures.empty) warnings.push(`Equipment research unavailable for ${researchFailures.size} model(s); reported symptoms are preserved in job notes.`);
    const financialFailures = await db.collection("financialReportRuns").where("status", "in", ["sending", "delivery_unknown"]).get();
    if (!financialFailures.empty) warnings.push(`${financialFailures.size} financial report email(s) have unconfirmed delivery. Check before resending.`);
    const brief = renderBrief(now, events, threads.docs.map((d) => d.data()), warnings);
    const html = renderBriefHtml(now, events, threads.docs.map((d) => d.data()), warnings);
    // Gmail has no idempotency key. Persist a send claim BEFORE calling it; an ambiguous
    // network failure is marked unknown instead of automatically sending duplicate email.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(run);
      if (["sending", "sent", "delivery_unknown"].includes(String(fresh.get("status")))) return false;
      tx.set(run, {status: "sending", recipient: OWNER_EMAIL, body: brief, html, format: "client-sections-v1", createdAt: admin.firestore.FieldValue.serverTimestamp()});
      return true;
    });
    if (!claimed) return;
    try {
      const messageId = await sendBrief(token, `Omnificology — daily brief for ${date}`, brief, date, html);
      await run.update({status: "sent", messageId, sentAt: admin.firestore.FieldValue.serverTimestamp()});
    } catch {
      await run.update({status: "delivery_unknown"});
      throw new Error("brief_delivery_unknown");
    }
  } catch (error) {
    const latest = await run.get();
    if (!["sent", "sending", "delivery_unknown"].includes(String(latest.get("status")))) await run.set({status: "failed", error: failureCode(error)}, {merge: true});
    logger.error("Daily lead brief failed", {date, code: failureCode(error)});
    throw new Error("daily_brief_failed");
  }
});
