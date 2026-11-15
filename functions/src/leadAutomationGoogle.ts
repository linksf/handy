/* eslint-disable require-jsdoc, max-len */
import {GoogleAuth} from "google-auth-library";
import {ANALYSIS_INSTRUCTIONS, ASSESSMENT_RESPONSE_SCHEMA, Assessment, assessmentSchema, hash, LeadMessage, managedFingerprint, OWNER_EMAIL, validateAssessment} from "./leadAutomationCore";

export class HttpFailure extends Error {
  constructor(public status: number, reason = "") {
    // Never log provider bodies, tokens, or customer conversation text.
    super(`provider_http_${status}${/^[A-Z][A-Z0-9_]{0,80}$/.test(reason) ? `_${reason.toLowerCase()}` : ""}`);
  }
}
export async function requestJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {...init, signal: AbortSignal.timeout(65000)});
  if (!response.ok) {
    // Keep only the provider's machine-readable reason; never persist error messages/bodies.
    const body = await response.json().catch(() => ({})) as {error?: {details?: {reason?: string}[]}};
    const reason = body.error?.details?.find((d) => typeof d.reason === "string")?.reason || "";
    throw new HttpFailure(response.status, reason);
  }
  if (response.status === 204) return {};
  return await response.json() as Record<string, unknown>;
}

export async function workspaceAccessToken(secret: string): Promise<string> {
  const config = JSON.parse(secret) as Record<string, string>;
  if (config.email !== OWNER_EMAIL || !config.client_id || !config.client_secret || !config.refresh_token) throw new Error("workspace_oauth_not_configured_for_owner");
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST", body: new URLSearchParams({
      client_id: config.client_id, client_secret: config.client_secret,
      refresh_token: config.refresh_token, grant_type: "refresh_token",
    }),
  });
  if (typeof token.access_token !== "string") throw new Error("missing_access_token");
  const identity = await requestJson("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {Authorization: `Bearer ${token.access_token}`},
  });
  if (identity.email !== OWNER_EMAIL || identity.email_verified !== true) throw new Error("wrong_google_account");
  return token.access_token;
}

export async function analyzeConversation(project: string, model: string, context: Record<string, unknown>, messages: LeadMessage[]): Promise<Assessment> {
  if (!/^[a-z0-9.-]+$/.test(model) || !project) throw new Error("ai_configuration_missing");
  const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
  const token = await auth.getAccessToken();
  const initialLead = context.lead as Record<string, unknown> || {};
  const initialLeadEvidence = [initialLead.name, initialLead.address, initialLead.jobInfo, JSON.stringify(initialLead.durationDetails || {})].filter(Boolean).join("\n");
  const evidenceMessages: LeadMessage[] = [...messages, {id: "initial-lead", leadId: "", sender: "Customer", source: "initial_lead", text: initialLeadEvidence, sentAt: new Date().toISOString()}];
  const response = await requestJson(`https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/publishers/google/models/${model}:generateContent`, {
    method: "POST", headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: ANALYSIS_INSTRUCTIONS}]},
      contents: [{role: "user", parts: [{text: JSON.stringify({...context, initialLeadEvidence, messages})}]}],
      generationConfig: {responseMimeType: "application/json", responseSchema: ASSESSMENT_RESPONSE_SCHEMA, maxOutputTokens: 8192},
    }),
  });
  const candidates = response.candidates as {finishReason?: string; content?: {parts?: {text?: string; thought?: boolean}[]}}[] | undefined;
  if (candidates?.[0]?.finishReason !== "STOP") throw new Error("ai_response_incomplete");
  const output = candidates[0].content?.parts?.filter((p) => !p.thought).map((p) => p.text || "").join("") || "";
  const assessment = validateAssessment(assessmentSchema.parse(JSON.parse(output)), evidenceMessages);
  const library = context.taskLibrary as {id: string}[] || [];
  if ((assessment.tasks || []).some((t) => t.taskDefId && !library.some((v) => v.id === t.taskDefId))) throw new Error("unsupported_task_template");
  return assessment;
}

export interface CalendarState {
  eventId: string;
  fingerprint: string;
  kind: string;
  end: string;
  revision: string;
}

export class CalendarApi {
  constructor(private token: string, private calendarId: string) {}
  private async call(path: string, method = "GET", body?: unknown, etag?: string): Promise<Record<string, unknown>> {
    return requestJson(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/${path}`, {
      method, headers: {"Authorization": `Bearer ${this.token}`, "Content-Type": "application/json", ...(etag ? {"If-Match": etag} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
  }
  async list(start: string, end: string): Promise<Record<string, unknown>[]> {
    const events: Record<string, unknown>[] = [];
    let page = "";
    do {
      const params = new URLSearchParams({timeMin: start, timeMax: end, singleEvents: "true", orderBy: "startTime", maxResults: "2500", ...(page ? {pageToken: page} : {})});
      const result = await this.call(`events?${params}`);
      events.push(...(result.items as Record<string, unknown>[] || []));
      page = String(result.nextPageToken || "");
    } while (page);
    return events;
  }
  async upsertTravel(id: string, desired: Record<string, unknown>): Promise<void> {
    let existing: Record<string, unknown> | null = null;
    try {
      existing = await this.call(`events/${id}`);
    } catch (error) {
      if (!(error instanceof HttpFailure && error.status === 404)) throw error;
    }
    const marker = ((existing?.extendedProperties as Record<string, unknown>)?.private || {}) as Record<string, string>;
    if (existing && (existing.status === "cancelled" || marker.handyTravel !== "v1" || managedFingerprint(existing) !== marker.managedFingerprint)) throw new Error("travel_event_edited_manually");
    const fingerprint = managedFingerprint(desired);
    const properties = (desired.extendedProperties as Record<string, unknown>)?.private as Record<string, string> || {};
    const body = {...desired, extendedProperties: {private: {...properties, handyTravel: "v1", managedFingerprint: fingerprint}}};
    if (!existing) await this.call("events?sendUpdates=none", "POST", {id, ...body});
    else if (managedFingerprint(existing) !== fingerprint) await this.call(`events/${id}?sendUpdates=none`, "PATCH", body, String(existing.etag));
  }
  async retireTravel(event: Record<string, unknown>): Promise<void> {
    if (event.transparency === "transparent") return;
    const marker = ((event.extendedProperties as Record<string, unknown>)?.private || {}) as Record<string, string>;
    if (marker.handyTravel !== "v1" || managedFingerprint(event) !== marker.managedFingerprint) throw new Error("travel_event_edited_manually");
    const desired = {...event, summary: `Cancelled — ${String(event.summary).replace(/^Cancelled — /, "")}`, transparency: "transparent"};
    await this.call(`events/${event.id}?sendUpdates=none`, "PATCH", {
      summary: desired.summary, transparency: "transparent",
      extendedProperties: {private: {...marker, managedFingerprint: managedFingerprint(desired)}},
    }, String(event.etag));
  }
  async syncOwnerVisit(jobId: string, visitId: string, eventId: string, desired: Record<string, unknown>, allowOverlap: boolean, from: string, to: string, leadId?: string): Promise<void> {
    let existing: Record<string, unknown> | null = null;
    try { existing = await this.call(`events/${eventId}`); }
    catch (error) { if (!(error instanceof HttpFailure && error.status === 404 && !leadId)) throw error; }
    const marker = ((existing?.extendedProperties as Record<string, unknown>)?.private || {}) as Record<string, string>;
    const ownerKey = hash(`owner-visit:${jobId}:${visitId}`);
    const ownsEvent = marker.handyVisit === ownerKey || (!!leadId && marker.thumbtackLeadId === leadId);
    if (existing && (!ownsEvent || existing.status === "cancelled" || managedFingerprint(existing) !== marker.managedFingerprint)) {
      throw new Error("calendar_event_changed");
    }
    if (!allowOverlap) {
      const conflicts = (await this.list(from, to)).some(event => event.id !== eventId &&
        event.status !== "cancelled" && event.transparency !== "transparent" &&
        !(leadId && ((event.extendedProperties as Record<string, any>)?.private?.thumbtackLeadId === leadId) &&
          String((event.extendedProperties as Record<string, any>)?.private?.handyTravel || "") === "v1"));
      if (conflicts) throw new Error("calendar_conflict");
    }
    const fingerprint = managedFingerprint(desired);
    const body = {...desired, extendedProperties: {private: {...marker, handyVisit: ownerKey, managedFingerprint: fingerprint}}};
    if (!existing) await this.call("events?sendUpdates=none", "POST", {id: eventId, ...body});
    else if (fingerprint !== marker.managedFingerprint || marker.handyVisit !== ownerKey) {
      await this.call(`events/${eventId}?sendUpdates=none`, "PATCH", body, String(existing.etag));
    }
  }
  async synchronize(leadId: string, desired: Record<string, unknown>, previous: CalendarState | null, revision: string, kind: string, cancelled: boolean, allowConflicts = false): Promise<CalendarState | null> {
    if (cancelled && !previous) return null;
    const priorEnded = previous && Date.parse(previous.end) < Date.now();
    const newVisit = !cancelled && priorEnded && String((desired.start as Record<string, unknown>).dateTime) !== previous.end;
    // A new visit after a finished appointment gets its own event. Reschedules retain the old ID.
    const active = newVisit ? null : previous;
    if (active && !cancelled && active.kind !== kind) throw new Error("appointment_type_changed_review_required");
    const eventId = active?.eventId || hash(`thumbtack:${leadId}:${newVisit ? previous?.eventId : "first"}`);
    let existing: Record<string, unknown> | null = null;
    try {
      existing = await this.call(`events/${eventId}`);
    } catch (error) {
      if (!(error instanceof HttpFailure && error.status === 404 && !active)) throw error;
    }
    if (existing?.status === "cancelled") throw new Error("calendar_event_deleted_manually");
    const marker = ((existing?.extendedProperties as Record<string, unknown>)?.private || {}) as Record<string, string>;
    if (marker.handyVisit) throw new Error("calendar_visit_managed_by_owner");
    if (existing && marker.thumbtackLeadId !== leadId) throw new Error("calendar_event_not_owned_by_automation");
    if (cancelled && existing) {
      desired = {
        summary: `Cancelled — ${String(existing.summary).replace(/^Cancelled — /, "")}`,
        description: existing.description || "", location: existing.location || "",
        start: existing.start, end: existing.end, transparency: "transparent",
      };
    }
    const fingerprint = managedFingerprint(desired);
    if (existing && managedFingerprint(existing) !== fingerprint &&
        managedFingerprint(existing) !== (active?.fingerprint || marker.managedFingerprint)) {
      throw new Error("calendar_event_edited_manually");
    }
    if (!cancelled && !allowConflicts) {
      const start = String((desired.start as Record<string, unknown>).dateTime);
      const end = String((desired.end as Record<string, unknown>).dateTime);
      const conflicts = (await this.list(start, end)).filter((e) => {
        const attendees = e.attendees as {self?: boolean; responseStatus?: string}[] | undefined;
        return e.id !== eventId && e.status !== "cancelled" && e.transparency !== "transparent" &&
          !attendees?.some((a) => a.self && a.responseStatus === "declined");
      });
      if (conflicts.length) throw new Error("calendar_conflict_review_required");
    }
    const body = {...desired, extendedProperties: {private: {...marker, thumbtackLeadId: leadId, managedFingerprint: fingerprint, automationRevision: revision}}};
    if (!existing) {
      // Custom IDs make ambiguous network failures safe to retry without duplicates.
      await this.call("events?sendUpdates=none", "POST", {id: eventId, ...body});
    } else if (managedFingerprint(existing) !== fingerprint) {
      await this.call(`events/${eventId}?sendUpdates=none`, "PATCH", body, String(existing.etag));
    }
    return {eventId, fingerprint, kind: active?.kind || kind,
      end: String((desired.end as Record<string, unknown>).dateTime), revision};
  }
}

export async function sendBrief(token: string, subject: string, plainText: string, date: string, html?: string): Promise<string> {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const encode = (s: string): string => Buffer.from(s).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  const boundary = `handy-brief-${hash(date).slice(0, 24)}`;
  const headers = [`From: ${OWNER_EMAIL}`, `To: ${OWNER_EMAIL}`, `Subject: ${encodedSubject}`, `Message-ID: <handy-brief-${date}@omnificology.com>`, "MIME-Version: 1.0"];
  const raw = html ? [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encode(plainText), `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encode(html), `--${boundary}--`, ""].join("\r\n") : [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encode(plainText)].join("\r\n");
  const result = await requestJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json"},
    body: JSON.stringify({raw: Buffer.from(raw).toString("base64url")}),
  });
  return String(result.id || "");
}
