export const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
});
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function recordDate(value) {
  if (value == null || value === "") return null;
  const date = value.toDate?.() ?? (typeof value.seconds === "number"
    ? new Date(value.seconds * 1000)
    : new Date(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function pacificDay(value) {
  if (typeof value === "string" && dayPattern.test(value)) {
    return recordDate(value)?.toISOString().slice(0, 10) === value ? value : "";
  }
  const date = recordDate(value);
  return date ? dayFormatter.format(date) : "";
}

export function shiftDay(day, offset) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function displayDay(day) {
  return day ? dateFormatter.format(new Date(day + "T00:00:00Z")) : "Date unknown";
}

export function displayPacificTime(value) {
  const date = recordDate(value);
  return date ? timeFormatter.format(date) : "";
}
