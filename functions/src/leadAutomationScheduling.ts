/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {GoogleAuth} from "google-auth-library";
import {Assessment, hash, pacificDate, TIME_ZONE} from "./leadAutomationCore";
import {CalendarApi, requestJson, sendBrief} from "./leadAutomationGoogle";
export type Event = Record<string, unknown>;
export const HOME = "645 Hayes St, San Francisco, CA 94102";
const MINUTE = 60000;
export const privateFields = (e: Event): Record<string, string> => ((e.extendedProperties as Event)?.private || {}) as Record<string, string>;
export const eventTime = (e: Event, side: "start" | "end"): number => {
  const p = e[side] as Event;
  if (p?.dateTime) return Date.parse(String(p.dateTime));
  if (p?.date) {
    const offset = new Intl.DateTimeFormat("en-US", {timeZone: TIME_ZONE, timeZoneName: "shortOffset"}).formatToParts(new Date(`${p.date}T00:00:00Z`)).find((x) => x.type === "timeZoneName")?.value;
    return Date.parse(`${p.date}T00:00:00Z`) - Number(offset?.replace("GMT", "") || 0) * 3600000;
  }
  return NaN;
};
export const busy = (e: Event): boolean => e.status !== "cancelled" && e.transparency !== "transparent" && !(e.attendees as {self?: boolean; responseStatus?: string}[] | undefined)?.some((a) => a.self && a.responseStatus === "declined");
export const overlaps = (a: Event, b: Event): boolean => eventTime(a, "start") < eventTime(b, "end") && eventTime(b, "start") < eventTime(a, "end");
const normalize = (s: unknown): string => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function historyForLead(events: Event[], lead: Event, now: number): Event[] {
  const name = normalize(lead.name); const address = normalize(lead.address);
  return events.filter((e) => busy(e) && !privateFields(e).handyTravel && eventTime(e, "end") < now && ((name.length > 3 && normalize(e.summary).includes(name)) || (address.length > 8 && normalize(e.location) === address)))
    .slice(-100).map((e) => ({id: e.id, summary: e.summary || "", location: e.location || "", description: String(e.description || "").slice(0, 2000), start: e.start, end: e.end, recurringEventId: e.recurringEventId || ""}));
}
// Sum paused/resumed timer sessions on the same Pacific day into one recorded visit.
export function recordedVisits(sessions: Event[], lead: Event, now: number): Event[] {
  const visits = new Map<string, {start: number; minutes: number}>();
  for (const session of sessions) {
    const start = Number(session.startMs); const end = Number(session.endMs);
    if (session.manual || !start || end <= start || end > now) continue;
    const date = pacificDate(new Date(start));
    const old = visits.get(date) || {start, minutes: 0};
    visits.set(date, {start: Math.min(old.start, start), minutes: old.minutes + (end - start) / MINUTE});
  }
  return [...visits].map(([date, visit]) => ({id: `work-session-${lead.jobId}-${date}`, summary: `${lead.name} — ${lead.jobTitle}`, location: lead.address || "",
    description: "Recorded work time for this same Handy job, summed by visit day (breaks excluded).",
    start: {dateTime: new Date(visit.start).toISOString()}, end: {dateTime: new Date(visit.start + visit.minutes * MINUTE).toISOString()}, source: "recorded_work"}));
}
export function chooseDuration(a: Assessment, history: Event[], calendar: Event[], ownId?: string, leadId?: string): {minutes: number; basis: string; rounded: boolean} {
  const start = Date.parse(a.appointment.start || "");
  let minutes = a.appointment.end ? (Date.parse(a.appointment.end) - start) / MINUTE : a.duration?.estimatedMinutes || 120;
  let basis = a.appointment.end ? "Duration agreed in conversation" : a.duration?.estimatedMinutes ? `Conservative estimate: ${a.duration.rationale}` : "Two-hour fallback; duration could not be inferred";
  if (a.duration?.recurring && !a.appointment.end) {
    const ids = new Set(a.duration.recurringHistoryEventIds);
    if ([...ids].some((id) => !history.some((e) => e.id === id))) throw new Error("unsupported_recurring_history");
    const selected = history.filter((e) => ids.has(String(e.id)));
    const recorded = selected.filter((e) => e.source === "recorded_work");
    const samples = (recorded.length ? recorded : selected).map((e) => (eventTime(e, "end") - eventTime(e, "start")) / MINUTE).filter((v) => v > 0 && v <= 1440);
    if (samples.length) {
      minutes = samples.reduce((sum, v) => sum + v, 0) / samples.length; basis = `Average of ${samples.length} prior visits for this recurring job (${Math.ceil(minutes)} minutes)`;
    }
  }
  if (!a.appointment.end && a.appointment.arrivalWindowEnd) {
    const buffer = (Date.parse(a.appointment.arrivalWindowEnd) - start) / MINUTE;
    if (!Number.isFinite(buffer) || buffer <= 0 || buffer > 180) throw new Error("invalid_arrival_window");
    minutes += buffer;
    basis += `; includes ${buffer} minutes for the agreed arrival window`;
  }
  minutes = Math.ceil(minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error("invalid_estimated_duration");
  const rounded = Math.ceil(minutes / 60) * 60;
  const room = !calendar.some((e) => busy(e) && e.id !== ownId && !(leadId && privateFields(e).thumbtackLeadId === leadId) && !(privateFields(e).handyTravel && ownId && [privateFields(e).fromJob, privateFields(e).toJob].includes(ownId)) && eventTime(e, "start") < start + rounded * MINUTE && eventTime(e, "end") > start + minutes * MINUTE);
  return {minutes: room ? rounded : minutes, basis: basis + (room && rounded !== minutes ? "; rounded up to a whole hour" : !room && rounded !== minutes ? "; no room for additional rounding" : ""), rounded: room && rounded !== minutes};
}
export interface Ride {minutes: number; note: string}
export type RouteEstimator = (origin: string, destination: string) => Promise<Ride>;
export async function bicycleRoute(project: string, origin: string, destination: string): Promise<Ride> {
  const token = await new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]}).getAccessToken();
  const result = await requestJson("https://routes.googleapis.com/directions/v2:computeRoutes", {method: "POST", headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json", "X-Goog-User-Project": project, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"}, body: JSON.stringify({origin: {address: origin}, destination: {address: destination}, travelMode: "BICYCLE"})});
  const route = (result.routes as {duration: string; distanceMeters: number}[] | undefined)?.[0];
  const seconds = route && /^\d+(\.\d+)?s$/.test(route.duration) ? Number(route.duration.slice(0, -1)) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("bicycle_route_unavailable");
  const minutes = Math.max(5, Math.ceil(seconds / 300) * 5);
  return {minutes, note: `Google Maps bicycle estimate: ${Math.ceil(seconds / 60)} minutes, ${(Number(route?.distanceMeters) / 1000).toFixed(1)} km. Reserved ${minutes} minutes (rounded up to five minutes).`};
}
export function cachedRoutes(db: admin.firestore.Firestore, project: string): RouteEstimator {
  return async (origin, destination) => {
    if (!origin || !destination) return {minutes: 30, note: "30-minute placeholder: job address is missing."};
    const ref = db.doc(`leadAutomationRoutes/${hash(`${origin}|${destination}|BICYCLE`)}`);
    const saved = await ref.get();
    if (Number(saved.get("expiresAt")) > Date.now()) return saved.get("ride") as Ride;
    const ride = await bicycleRoute(project, origin, destination);
    await ref.set({ride, expiresAt: Date.now() + 7 * 86400000});
    return ride;
  };
}
export async function planTravel(events: Event[], route: RouteEstimator, now: number): Promise<Event[]> {
  const jobs = events.filter((e) => busy(e) && !privateFields(e).handyTravel && Number.isFinite(eventTime(e, "start")) && Boolean((e.start as Event)?.dateTime)).sort((a, b) => eventTime(a, "start") - eventTime(b, "start") || String(a.id).localeCompare(String(b.id)));
  const plans = new Map<string, Event>();
  const add = async (from: Event | null, to: Event | null, job: Event, side: "before" | "after") => {
    const id = hash(`handy-travel:${from?.id || "home"}:${to?.id || "home"}`);
    if (plans.has(id)) return;
    const origin = from ? String(from.location || "") : HOME;
    const destination = to ? String(to.location || "") : HOME;
    const ride = !origin || !destination ? {minutes: 30, note: "30-minute placeholder: job address is missing."} : await route(origin, destination);
    const start = to ? eventTime(to, "start") - ride.minutes * MINUTE : eventTime(from || job, "end");
    plans.set(id, {id, summary: `Bike travel — ${from && to ? `${String(from.summary).split(" — ")[0]} → ${String(to.summary).split(" — ")[0]}` : side === "before" ? `to ${String(job.summary).split(" — ")[0]}` : `from ${String(job.summary).split(" — ")[0]}`}`,
      location: `${origin || "Address pending"} → ${destination || "Address pending"}`, description: `${ride.note}\nFrom: ${origin || "Address pending"}\nTo: ${destination || "Address pending"}\nSeparate travel reservation; no customer invitations.`,
      start: {dateTime: new Date(start).toISOString(), timeZone: TIME_ZONE}, end: {dateTime: new Date(start + ride.minutes * MINUTE).toISOString(), timeZone: TIME_ZONE}, transparency: "opaque",
      extendedProperties: {private: {handyTravel: "v1", fromJob: String(from?.id || ""), toJob: String(to?.id || "")}},
    });
  };
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!privateFields(job).thumbtackLeadId || eventTime(job, "end") <= now) continue;
    const before = jobs.slice(0, i).filter((e) => eventTime(e, "end") <= eventTime(job, "start") && eventTime(job, "start") - eventTime(e, "end") <= 3600000).sort((a, b) => eventTime(b, "end") - eventTime(a, "end"))[0] || null;
    const after = jobs.slice(i + 1).find((e) => eventTime(e, "start") >= eventTime(job, "end") && eventTime(e, "start") - eventTime(job, "end") <= 3600000) || null;
    await add(before, job, job, "before"); await add(job, after, job, "after");
  }
  return [...plans.values()];
}
export function findConflicts(events: Event[], now: number): {id: string; first: Event; second: Event}[] {
  const active = events.filter((e) => busy(e) && eventTime(e, "end") > now);
  const pairs = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]; const b = active[j];
      if (![a, b].some((e) => privateFields(e).thumbtackLeadId || privateFields(e).handyTravel) || !overlaps(a, b)) continue;
      const signature = [a, b].map((e) => `${e.id}:${eventTime(e, "start")}:${eventTime(e, "end")}`).sort().join("|");
      pairs.push({id: hash(signature), first: a, second: b});
    }
  }
  return pairs;
}
export async function notifyConflicts(db: admin.firestore.Firestore, token: string, events: Event[], now: number): Promise<void> {
  for (const conflict of findConflicts(events, now)) {
    const ref = db.doc(`leadAutomationConflictAlerts/${conflict.id}`);
    const claimed = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref); if (existing.exists) return false; tx.create(ref, {status: "sending", createdAt: admin.firestore.FieldValue.serverTimestamp(), eventIds: [conflict.first.id, conflict.second.id]}); return true;
    });
    if (!claimed) continue;
    const describe = (e: Event): string => `${e.summary}\n${new Date(eventTime(e, "start")).toLocaleString("en-US", {timeZone: TIME_ZONE})} – ${new Date(eventTime(e, "end")).toLocaleString("en-US", {timeZone: TIME_ZONE})} Pacific\n${e.location || "Address pending"}\n${e.htmlLink || ""}`;
    try {
      const messageId = await sendBrief(token, "Omnificology — scheduling conflict", `These calendar reservations overlap:\n\n${describe(conflict.first)}\n\n${describe(conflict.second)}\n\nThe reservations remain on your calendar. Please resolve the overlap; no customer has been contacted.`, `conflict-${conflict.id}`);
      await ref.update({status: "sent", messageId, sentAt: admin.firestore.FieldValue.serverTimestamp()});
    } catch {
      await ref.update({status: "delivery_unknown"}); throw new Error("conflict_email_delivery_unknown");
    }
  }
}
export async function reconcileTravel(db: admin.firestore.Firestore, calendar: CalendarApi, token: string, rangeEnd: string): Promise<void> {
  const now = Date.now(); const start = new Date(now - 86400000).toISOString();
  let events = await calendar.list(start, rangeEnd);
  // A routing failure must not prevent notification of a job conflict.
  await notifyConflicts(db, token, events.filter((e) => !privateFields(e).handyTravel), now);
  try {
    const plans = await planTravel(events, cachedRoutes(db, process.env.GCLOUD_PROJECT || ""), now);
    for (const plan of plans) await calendar.upsertTravel(String(plan.id), plan);
    const desiredIds = new Set(plans.map((e) => e.id));
    for (const existing of events) if (privateFields(existing).handyTravel === "v1" && eventTime(existing, "start") > now && !desiredIds.has(existing.id)) await calendar.retireTravel(existing);
  } finally {
    // Even a partial write or protected manual edit must not suppress conflict alerts.
    events = await calendar.list(start, rangeEnd);
    await notifyConflicts(db, token, events, now);
  }
}
