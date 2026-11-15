/* eslint-disable require-jsdoc, valid-jsdoc, max-len */
import {Assessment, pacificDate, TIME_ZONE} from "./leadAutomationCore";
import {Row} from "./leadIntroCore";
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c] || c));
const lines = (value: unknown): string => escape(value).replace(/\r?\n/g, "<br>");
function link(value: unknown, label: string): string {
  try {
    const u = new URL(String(value)); if (u.protocol === "https:") return `<a href="${escape(u.href)}" style="color:#126f68;text-decoration:underline">${escape(label)}</a>`;
  } catch {/* Omit malformed links. */}
  return "";
}
const list = (items: string[]): string => `<ul style="margin:8px 0 0;padding-left:22px">${items.map((s) => `<li style="margin:0 0 8px;line-height:1.6">${s}</li>`).join("")}</ul>`;
const title = (text: string): string => `<h3 style="font-size:13px;letter-spacing:.04em;color:#53636e;margin:18px 0 6px;text-transform:uppercase">${text}</h3>`;
const card = (name: string, body: string): string => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #dce5e9;border-radius:10px;background:#ffffff"><tr><td style="padding:22px 24px"><h2 style="font-size:21px;line-height:1.3;margin:0 0 10px;color:#143444">${escape(name)}</h2>${body}</td></tr></table>`;
function when(v: Row | undefined): string {
  if (v?.dateTime && Number.isFinite(Date.parse(v.dateTime))) return new Date(v.dateTime).toLocaleString("en-US", {timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  return `${v?.date || "Date unknown"} (all day)`;
}
interface Client {name: string; summary: string; leadId: string; events: Row[]; follow: string[]; attention: string[]}
export function renderBriefHtml(now: Date, events: Row[], threads: Row[], warnings: string[]): string {
  const clients = new Map<string, Client>();
  const ensure = (id: string, name: string): Client => {
    if (!clients.has(id)) clients.set(id, {name, summary: "", leadId: id, events: [], follow: [], attention: []});
    return clients.get(id) as Client;
  };
  for (const item of threads) {
    const a = item.assessment as Assessment | undefined;
    const name = a?.clientName || item.lead?.name || `Lead ${item.leadId}`;
    const c = ensure(String(item.leadId), name);
    if (item.lastError) c.attention.push(String(item.lastError).replace(/_/g, " "));
    if (item.dirty || item.assessedVersion !== item.version) {
      c.attention.push("New information is waiting to be processed."); continue;
    }
    if (!a) continue;
    c.summary = a.jobSummary;
    const follow = a.followUp;
    if (follow.owner !== "none") {
      const due = follow.dueAt ? Date.parse(follow.dueAt) : null;
      const waiting = now.getTime() - (item.updatedAt?.toMillis?.() || now.getTime()) >= 48 * 3600000;
      if ((due !== null && due <= now.getTime() + 24 * 3600000) || (due === null && (follow.owner === "business" || waiting))) {
        c.follow.push(`<strong>${follow.owner === "business" ? "Your follow-up" : "Waiting on client"}:</strong> ${lines(follow.reason)}${due !== null ? `<br><span style="color:#53636e">Due ${escape(when({dateTime: follow.dueAt}))}</span>` : ""}`);
      }
    }
    c.attention.push(...a.needsReview);
    if (item.calendarReview && !["completed", "lost"].includes(a.stage) && ["confirmed", "cancelled"].includes(a.appointment.status)) c.attention.push(String(item.calendarReview));
  }
  const visible = events.filter((e) => e.status !== "cancelled" && !String(e.summary).startsWith("Cancelled — "));
  const other: Row[] = [];
  for (const event of visible) {
    const id = event.extendedProperties?.private?.thumbtackLeadId;
    if (id) ensure(String(id), String(event.summary || "Client appointment")).events.push(event);
    else other.push(event);
  }
  const renderEvent = (e: Row): string => {
    const end = e.end?.dateTime && Number.isFinite(Date.parse(e.end.dateTime)) ? ` to ${new Date(e.end.dateTime).toLocaleTimeString("en-US", {timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit"})}` : "";
    const notes = String(e.description || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => escape(s.replace(/^[-•]\s*/, "")));
    return `<div style="margin:0 0 16px"><p style="margin:0 0 6px"><strong>${escape(when(e.start))}${escape(end)}</strong></p><p style="margin:0 0 6px">${escape(e.summary || "Untitled appointment")}</p>${e.location ? `<p style="margin:8px 0"><strong>Address:</strong> ${escape(e.location)}</p>` : ""}${notes.length ? list(notes) : ""}${e.htmlLink ? `<p style="margin:10px 0 0">${link(e.htmlLink, "Open calendar event")}</p>` : ""}</div>`;
  };
  const active = [...clients.values()].filter((c) => c.events.length || c.follow.length || c.attention.length);
  active.sort((a, b) => {
    const start = (c: Client): number => Math.min(...c.events.map((e) => Date.parse(e.start?.dateTime || `${e.start?.date}T12:00:00Z`)).filter(Number.isFinite));
    return start(a) - start(b) || a.name.localeCompare(b.name);
  });
  const clientCards = active.map((c) => card(c.name, `${c.summary ? `<p style="margin:0 0 12px;color:#53636e;line-height:1.6">${lines(c.summary)}</p>` : ""}${c.events.length ? `${title("Upcoming visits")}${c.events.map(renderEvent).join("")}` : ""}${c.follow.length ? `${title("Follow-ups")}${list(c.follow)}` : ""}${c.attention.length ? `<div style="margin-top:16px;padding:12px 14px;background:#fff6e8;border-left:3px solid #d39b40">${title("Needs attention")}${list([...new Set(c.attention)].map(lines))}</div>` : ""}<p style="margin:16px 0 0">${link(`https://handy.omnificology.com/admin/leads/${encodeURIComponent(c.leadId)}`, "Review client lead")}</p>`)).join("");
  const ops = warnings.length ? card("Business alerts", list([...new Set(warnings)].map(lines))) : "";
  const empty = !visible.length ? `<p style="line-height:1.6;margin:0 0 20px;color:#53636e">${warnings.length ? "Calendar availability could not be verified; see business alerts." : "No upcoming appointments on the selected calendar."}</p>` : "";
  const calendar = other.length ? card("Other calendar items", other.map(renderEvent).join("")) : "";
  const followCount = active.reduce((n, c) => n + c.follow.length, 0);
  const date = now.toLocaleDateString("en-US", {timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric"});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Omnificology daily brief</title></head><body style="margin:0;padding:0;background:#f2f5f7;font-family:Arial,Helvetica,sans-serif;color:#243d4b;font-size:15px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px"><tr><td style="padding:26px 24px;background:#143444;border-radius:10px;color:#ffffff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em">OMNIFICOLOGY</p><h1 style="font-size:28px;margin:0 0 10px">Your daily brief</h1><p style="margin:0;line-height:1.6">${escape(date)}<br>All times Pacific &middot; Upcoming 7 days</p></td></tr><tr><td style="padding:20px 0"><p style="margin:0 0 20px;color:#53636e;line-height:1.6"><strong>${active.length}</strong> client sections &nbsp;&middot;&nbsp; <strong>${visible.length}</strong> calendar items &nbsp;&middot;&nbsp; <strong>${followCount}</strong> follow-ups</p>${ops}${empty}${clientCards}${calendar}${!active.length ? "<p style=\"line-height:1.6\">No client follow-ups or review items are flagged.</p>" : ""}<p style="font-size:12px;line-height:1.7;color:#647782;margin:24px 8px 0">Based on captured Thumbtack conversations and the selected Google Calendar. Conversations from before message capture began may be incomplete.<br>Brief date: ${escape(pacificDate(now))}</p></td></tr></table></td></tr></table></body></html>`;
}
