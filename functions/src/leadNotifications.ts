/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {hash, OWNER_EMAIL, TIME_ZONE} from "./leadAutomationCore";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export function notificationPlans(threadId: string, before: Row, after: Row, now: number): Row[] {
  const a = after.assessment;
  if (!a) return [];
  const name = a.clientName || before.lead?.name || "Thumbtack client";
  const base = {threadId, version: after.processedVersion, clientName: name};
  const plans: Row[] = [];
  const calendar = after.calendar;
  if (calendar && (!before.calendar || calendar.eventId !== before.calendar.eventId || calendar.fingerprint !== before.calendar.fingerprint) && Date.parse(calendar.end) > now) {
    const cancelled = after.calendarStatus === "cancelled";
    const label = cancelled ? "Booking cancelled" : before.calendar?.eventId === calendar.eventId ? "Booking updated" : "Job added to your calendar";
    const when = a.appointment.start ? new Date(a.appointment.start).toLocaleString("en-US", {timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short"}) : "See calendar";
    const link = `https://www.google.com/calendar/event?eid=${Buffer.from(`${calendar.eventId} ${OWNER_EMAIL}`).toString("base64url")}`;
    plans.push({...base, id: hash(`booking:${calendar.eventId}:${calendar.fingerprint}`).slice(0, 24), kind: "booking", text: `${label}\n${name}\n${when} Pacific\n${after.booking ? `Reserved duration: ${after.booking.minutes} minutes (see event for estimate details).\n` : ""}${a.address || "Address pending"}\n${a.jobSummary}\n${link}`});
  }
  if (!["completed", "cancelled", "lost"].includes(a.stage)) {
    const issues: string[] = [...a.needsReview];
    if (after.calendarStatus === "booked" && Date.parse(calendar?.end || "") > now && !a.address) issues.push("What is the job's street address? The booking is saved with placeholder travel time.");
    // An issue explicitly marked ambiguous must still be surfaced when the model's
    // tentative date happens to be past. The question includes the source timestamp.
    if (issues.length) {
      const key = hash(`question:${threadId}:${after.processedVersion}:${JSON.stringify(issues)}`).slice(0, 24);
      if (before.notificationQuestionKey !== key) {
        plans.push({...base, id: hash(`${key}:${after.processedVersion}`).slice(0, 24), questionKey: key, kind: "clarification", issues,
          text: `Scheduling question — ${name}\n${a.jobSummary}\n\n${issues.map((v) => `• ${v}`).join("\n")}\n\n${after.notificationContext || ""}\n\nReply to this message with the clarification. Your reply is private; it is not sent to the client.`, ampm: issues.length === 1 && /AM\s*(?:\/|or)\s*PM|AM or PM/i.test(issues[0])});
      }
    }
  }
  return plans;
}

export async function acceptClarification(db: admin.firestore.Firestore, id: string, answer: string, updateId: number): Promise<string> {
  if (!answer.trim() || answer.length > 3000) return "Please reply with a short clarification (up to 3,000 characters).";
  const question = db.doc(`leadNotifications/${id}`);
  return db.runTransaction(async (tx) => {
    const q = await tx.get(question);
    if (!q.exists || q.get("kind") !== "clarification") return "Please reply directly to a scheduling question.";
    const ref = db.doc(`thumbtackConversations/${q.get("threadId")}`);
    const fresh = await tx.get(ref);
    if (q.get("answered")) return "That question has already been answered.";
    if (!fresh.exists || Number(fresh.get("version")) !== Number(q.get("version"))) return "Newer messages have arrived since that question. I will recheck them; please use the latest question.";
    const id = `owner-telegram-${updateId}`;
    const event = ref.collection("events").doc(id);
    const old = await tx.get(event);
    if (old.exists) return "Your clarification is already saved.";
    const now = new Date().toISOString();
    tx.create(event, {id, kind: "message", source: "owner_clarification", sender: "Business", leadId: fresh.get("leadId"), sentAt: now,
      text: `Private clarification from Shane about this earlier scheduling question: ${q.get("text")}\nAnswer: ${answer.trim()}`, receivedAt: admin.firestore.FieldValue.serverTimestamp()});
    tx.update(ref, {version: Number(fresh.get("version")) + 1, dirty: true, nextAttemptAt: admin.firestore.Timestamp.fromMillis(0), notificationQuestionKey: null, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
    tx.update(question, {answered: true, answer: answer.trim(), answeredAt: admin.firestore.FieldValue.serverTimestamp()});
    return "Clarification saved. I’ll recheck the conversation and notify you when the calendar is updated, or if anything still needs clarification.";
  });
}
