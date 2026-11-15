/* eslint-disable require-jsdoc, max-len */
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret, defineString} from "firebase-functions/params";
import {CalendarApi, workspaceAccessToken} from "./leadAutomationGoogle";
import {hash, OWNER_EMAIL, TIME_ZONE} from "./leadAutomationCore";
import {dbForLeads, Row} from "./leadWorkflow";
import {isOwnerAuth} from "./ownerAuth";

const oauth = defineSecret("LEAD_AUTOMATION_GOOGLE_OAUTH");
const calendarId = defineString("LEAD_AUTOMATION_CALENDAR_ID", {default: OWNER_EMAIL});

export const syncAdminVisit = onCall({secrets: [oauth], timeoutSeconds: 120}, async request => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  const {jobId, visitId, revision} = request.data || {};
  if (![jobId, visitId, revision].every(value => typeof value === "string" && /^[\w-]{1,160}$/.test(value))) {
    throw new HttpsError("invalid-argument", "Invalid visit reference.");
  }
  const db = dbForLeads();
  const ref = db.doc(`jobs/${jobId}`);
  const job = (await ref.get()).data();
  const visit = job?.visits?.find((row: Row) => row.id === visitId);
  if (!job || !visit || visit.revision !== revision || !["scheduled", "deferred", "cancelled"].includes(visit.status) || job.status === "Archived") {
    throw new HttpsError("failed-precondition", "This visit has changed.");
  }
  const inactive = visit.status !== "scheduled";
  if (inactive && !visit.calendarEventId) return {syncStatus: "untracked", syncError: null};
  const start = Date.parse(visit.start);
  const end = Date.parse(visit.end);
  const buffer = Number(visit.travelMinutes || 0) * 60000;
  if (!Number.isFinite(start) || !(end > start) || !(buffer >= 0 && buffer <= 180 * 60000)) {
    throw new HttpsError("invalid-argument", "Invalid visit times.");
  }
  const eventId = visit.calendarEventId || hash(`owner-visit:${jobId}:${visitId}`);
  if (!/^[\w-]+$/.test(eventId)) throw new HttpsError("invalid-argument", "Invalid calendar event.");
  const leaseUntil = Date.now() + 125000;
  await db.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).data();
    const rows: Row[] = current?.visits || [];
    const target = rows.find(row => row.id === visitId);
    if (!target || target.revision !== revision || target.syncLeaseUntil > Date.now()) {
      throw new HttpsError("aborted", "Another sync is in progress or this visit changed.");
    }
    transaction.update(ref, {visits: rows.map(row => row.id === visitId ? {...row, syncLeaseUntil: leaseUntil} : row)});
  });
  let syncStatus = "synced";
  let syncError: string | null = null;
  try {
    const calendar = new CalendarApi(await workspaceAccessToken(oauth.value()), calendarId.value());
    await calendar.syncOwnerVisit(jobId, visitId, eventId, {
      summary: `${visit.status === "cancelled" ? "Cancelled · " : inactive ? "Postponed · " : ""}${job.title} · ${visit.kind}`, location: visit.address || "",
      description: `Handy visit · ${visit.travelMinutes || 0} min travel each way`,
      start: {dateTime: visit.start, timeZone: TIME_ZONE}, end: {dateTime: visit.end, timeZone: TIME_ZONE},
      transparency: inactive ? "transparent" : "opaque",
    }, inactive || !!visit.allowOverlap && !!visit.overlapReason, new Date(start - buffer).toISOString(), new Date(end + buffer).toISOString(),
    visit.calendarEventId && job.leadId ? job.leadId : undefined);
  } catch (error) {
    syncStatus = "failed";
    const message = (error as Error).message;
    syncError = message === "calendar_conflict" ? "Calendar overlap. Review the time or allow intentional overlap."
      : message === "calendar_event_changed" ? "Calendar event changed externally. Review it before retrying."
        : "Calendar unavailable. Retry sync.";
  }
  await db.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).data();
    const rows: Row[] = current?.visits || [];
    if (!rows.some(row => row.id === visitId && row.revision === revision && row.syncLeaseUntil === leaseUntil)) {
      throw new HttpsError("aborted", "Visit changed during sync. Sync the latest version.");
    }
    transaction.update(ref, {visits: rows.map(row => row.id === visitId ? {
      ...row, syncStatus, syncError, syncLeaseUntil: null, ...(syncStatus === "synced" ? {calendarEventId: eventId} : {}),
    } : row)});
  });
  return {syncStatus, syncError};
});
