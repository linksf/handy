import { expect, test } from "vitest";
import { pacificInput, pacificMillis, visitConflicts } from "./visitTime";
import { roundBillable } from "./workSessionStore";

test("Pacific visit input handles daylight time and rejects ambiguous clock values", () => {
  expect(new Date(pacificMillis("2026-07-17T09:00")).toISOString()).toBe("2026-07-17T16:00:00.000Z");
  expect(pacificInput("2026-11-14T17:00:00Z")).toBe("2026-11-14T09:00");
  expect(pacificMillis("2026-03-08T02:30")).toBeNull();
  expect(pacificMillis("2026-11-01T01:30")).toBeNull();
});

test("rescheduling excludes the selected visit and its request while checking travel against other visits", () => {
  const start = Date.parse("2099-07-12T16:00:00Z");
  const jobs = [{ id: "j", title: "Job", visits: [
    { id: "v", requestId: "r", kind: "Assessment", status: "scheduled", start: new Date(start).toISOString(), end: new Date(start + 1800000).toISOString() },
    { id: "v2", kind: "Return visit", status: "scheduled", start: new Date(start + 3600000).toISOString(), end: new Date(start + 7200000).toISOString() },
  ] }];
  const bookings = [{ id: "r", status: "approved", requestedStart: start, requestedEnd: start + 1800000 }];
  expect(visitConflicts({ jobs, bookings, jobId: "j", visitId: "v", start, end: start + 2400000, travel: 30 }))
    .toEqual(["Job · Return visit"]);
  expect(roundBillable(80)).toBe(60);
});
