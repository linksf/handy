/* eslint-disable require-jsdoc, valid-jsdoc, max-len */
import {OWNER_EMAIL, TIME_ZONE, pacificDate} from "./leadAutomationCore";
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Interval {start: number; end: number}
export interface Window extends Interval {date: string; latestStart: number}
export const INTRO_POLICY = "intro-v2";
export const CALENDAR_ID = OWNER_EMAIL;
const MINUTE = 60000;
export function localInstant(date: string, hour = 0, minute = 0): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_local_date");
  const target = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  let guess = target;
  for (let n = 0; n < 4; n++) {
    const parts = new Intl.DateTimeFormat("en-CA", {timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"}).formatToParts(guess);
    const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
    const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if (actual === target) return guess;
    guess += target - actual;
  }
  throw new Error("ambiguous_local_time");
}
export function mergeIntervals(rows: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const row of rows.filter((v) => v.end > v.start).sort((a, b) => a.start - b.start)) {
    const last = result[result.length - 1];
    if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
    else result.push({...row});
  }
  return result;
}
export function proposedIntervals(lead: Row): Interval[] {
  const values = lead.durationDetails?.proposedTimes || lead.payload?.request?.proposedTimes || [];
  if (!Array.isArray(values) || values.length > 100) throw new Error("invalid_proposed_times");
  return mergeIntervals(values.map((v: Row) => {
    if (![v.start, v.end].every((s) => typeof s === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(s))) throw new Error("proposed_time_offset_missing");
    const start = Date.parse(v.start); const end = Date.parse(v.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 32 * 86400000) throw new Error("invalid_proposed_times");
    return {start, end};
  }));
}
export function busyIntervals(events: Row[]): Interval[] {
  return mergeIntervals(events.filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && !e.attendees?.some((a: Row) => a.self && a.responseStatus === "declined")).map((e) => {
    const boundary = (p: Row): number => p?.dateTime ? Date.parse(p.dateTime) : p?.date ? localInstant(p.date) : NaN;
    const start = boundary(e.start); const end = boundary(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("invalid_calendar_event");
    return {start, end};
  }));
}
/** The entire travel/work/travel footprint fits inside 10:00-20:00 and avoids busy events. */
export function appointmentWindows(proposed: Interval[], busy: Interval[], now: number, durationMinutes = 120): Window[] {
  const duration = Math.max(120, durationMinutes) * MINUTE;
  const result: Window[] = [];
  for (const p of mergeIntervals(proposed)) {
    if (p.end - p.start > 32 * 86400000) throw new Error("proposal_range_too_large");
    let date = pacificDate(new Date(p.start));
    for (let day = 0; day < 33 && localInstant(date) < p.end; day++) {
      let gaps: Interval[] = [{start: Math.max(localInstant(date, 10), now), end: localInstant(date, 20)}];
      for (const b of mergeIntervals(busy)) gaps = gaps.flatMap((g) => b.end <= g.start || b.start >= g.end ? [g] : [{start: g.start, end: Math.min(g.end, b.start)}, {start: Math.max(g.start, b.end), end: g.end}].filter((v) => v.end > v.start));
      for (const g of gaps) {
        // Proposed bounds constrain work; travel may lie outside those bounds, inside the workday.
        const start = Math.ceil(Math.max(g.start + 30 * MINUTE, p.start) / (30 * MINUTE)) * 30 * MINUTE;
        const end = Math.floor(Math.min(g.end - 30 * MINUTE, p.end) / (30 * MINUTE)) * 30 * MINUTE;
        if (end - start >= duration) result.push({date, start, end, latestStart: end - duration});
      }
      date = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    }
  }
  return result.sort((a, b) => a.start - b.start);
}
const time = (value: number): string => new Intl.DateTimeFormat("en-US", {timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit"}).format(value);
export function availabilityText(windows: Window[]): string {
  const dates = new Map<string, {label: string; ranges: string[]}>();
  for (const w of windows) {
    if (w.end - w.start < 120 * MINUTE || w.start % (30 * MINUTE) || w.end % (30 * MINUTE)) throw new Error("invalid_display_window");
    const row = dates.get(w.date) || {label: new Intl.DateTimeFormat("en-US", {timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric"}).format(w.start).replace(",", ""), ranges: []};
    row.ranges.push(`${time(w.start)} to ${time(w.end)}`);
    dates.set(w.date, row);
  }
  return [...dates.values()].map((row) => `${row.label} ${row.ranges.join("; ")}`).join("\n");
}
export function composeIntro(name: string, acknowledgment: string, quoteRequested: boolean, windows: Window[]): string {
  const first = name.trim().split(/\s+/)[0];
  if (!first || /[\r\n<>]/.test(first)) throw new Error("customer_first_name_missing");
  if (!acknowledgment || acknowledgment.length > 180 || /[\r\n?]|\b(?:\d|am|pm|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|quote|estimate|schedule|book|available)\b/i.test(acknowledgment)) throw new Error("invalid_intro_acknowledgment");
  const scheduling = quoteRequested ? "I'll get back to you soon with a quote." : windows.length ? `I'm available:\n${availabilityText(windows)}\n\nLet me know which time works for you or if you have any questions.` : "What day and time would work for you? I'll check my calendar before we book.";
  return `Hi ${first},\n\n${acknowledgment.trim()}\n\n${scheduling}\n\n-Shane Alan`;
}
