/** Expand an availability document into bookable sub-slots. */
/**
 * Same geometry as the client’s expandSlots, but for admin: split a [start, end) window
 * into N non-overlapping chunks of `slotMins` (e.g. 10am-10pm, 60 min → 12 chunks).
 */
function splitTimeWindowIntoSlotChunks(start, end, slotMins) {
  const durMs = Math.max(15, Number(slotMins) || 60) * 60 * 1000;
  const s0 = start.getTime();
  const e0 = end.getTime();
  if (!(e0 > s0)) return [];
  const out = [];
  for (let t = s0; t + durMs <= e0; t += durMs) {
    out.push({ start: new Date(t), end: new Date(t + durMs) });
  }
  return out;
}

function expandSlots(avail) {
  const id = avail.id ?? avail.availabilityId;
  const { start, end, slotDurationMinutes = 60 } = avail;
  const s = start?.toDate ? start.toDate() : new Date(start);
  const e = end?.toDate ? end.toDate() : new Date(end);
  const chunks = splitTimeWindowIntoSlotChunks(s, e, slotDurationMinutes);
  return chunks.map((c) => ({
    availabilityId: id,
    start: c.start,
    end: c.end,
  }));
}

/** Stable key for a generated slot (client UI). */
function slotKey(s) {
  return `${s.availabilityId}-${s.start.getTime()}`;
}

/** Sub-ms / Firestore Timestamp noise when matching slot boundaries. */
const CHAIN_EPS_MS = 8;

function approxSameInstant(aMs, bMs) {
  return Math.abs(aMs - bMs) <= CHAIN_EPS_MS;
}

function findNextContiguousSlot(allSlots, cur) {
  const endMs = cur.end.getTime();
  const day = dayKey(cur.start);
  return allSlots.find(
    (s) =>
      dayKey(s.start) === day &&
      approxSameInstant(s.start.getTime(), endMs)
  );
}

/**
 * If first/last are in the same availability block and every sub-slot between them exists
 * in `allSlots`, returns the merged window. Otherwise null.
 * Includes `loSlot` / `hiSlot` as the actual rows from `allSlots` used for the chain ends.
 */
function mergeContiguousSlotRange(firstSlot, lastSlot, allSlots) {
  let lo = firstSlot;
  let hi = lastSlot;
  if (lo.start.getTime() > hi.start.getTime()) [lo, hi] = [hi, lo];
  if (dayKey(lo.start) !== dayKey(hi.start)) return null;
  let cur = lo;
  const targetEndMs = hi.end.getTime();
  while (cur.end.getTime() < targetEndMs - CHAIN_EPS_MS) {
    const next = findNextContiguousSlot(allSlots, cur);
    if (!next) return null;
    cur = next;
  }
  if (!approxSameInstant(cur.end.getTime(), targetEndMs)) return null;
  return {
    availabilityId: lo.availabilityId,
    start: lo.start,
    end: hi.end,
    loSlot: lo,
    hiSlot: cur,
  };
}

/** Set of slotKey() for every sub-slot from lo through hi (inclusive), or empty if not a valid chain. */
function contiguousSlotKeysInRange(allSlots, lo, hi) {
  const merged = mergeContiguousSlotRange(lo, hi, allSlots);
  if (!merged) return new Set();
  const keys = new Set();
  const endMs = merged.end.getTime();
  let cur = allSlots.find(
    (s) =>
      dayKey(s.start) === dayKey(merged.start) &&
      approxSameInstant(s.start.getTime(), merged.start.getTime())
  );
  while (cur && cur.end.getTime() <= endMs + CHAIN_EPS_MS) {
    keys.add(slotKey(cur));
    if (approxSameInstant(cur.end.getTime(), endMs)) break;
    const next = findNextContiguousSlot(allSlots, cur);
    if (!next) break;
    cur = next;
  }
  return keys;
}

/** YYYY-MM-DD in the user's local calendar (not UTC — avoids grouping vs display mismatch). */
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inverse of dayKey: local midnight for that calendar day (for headings). */
function localDateFromDayKey(dayKeyStr) {
  const parts = dayKeyStr.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return new Date(NaN);
  const [y, mo, d] = parts;
  return new Date(y, mo - 1, d);
}

function groupSlotsByDay(slots) {
  const map = new Map();
  for (const slot of slots) {
    const k = dayKey(slot.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(slot);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Group slots by calendar day, then into back-to-back time runs (ignores availability doc id).
 * Use for client booking so adjacent 1-hour blocks merge into multi-hour ranges.
 */
function groupSlotsByDayContiguous(slots) {
  const byDay = groupSlotsByDay(slots);
  return byDay.map(([day, daySlots]) => {
    const sorted = [...daySlots].sort((a, b) => a.start.getTime() - b.start.getTime());
    const runs = [];
    let run = [];
    for (const s of sorted) {
      if (run.length === 0) {
        run.push(s);
      } else {
        const last = run[run.length - 1];
        if (approxSameInstant(last.end.getTime(), s.start.getTime())) run.push(s);
        else {
          runs.push(run);
          run = [s];
        }
      }
    }
    if (run.length) runs.push(run);
    return [day, runs];
  });
}

/**
 * Like `groupSlotsByDay`, but each day’s slots are split into runs of the same `availabilityId`
 * with back-to-back times only—so adjacent hours from different Firestore blocks are not one row.
 */
function groupSlotsByDayAndRun(slots) {
  const byDay = groupSlotsByDay(slots);
  return byDay.map(([day, daySlots]) => {
    const sorted = [...daySlots].sort((a, b) => a.start.getTime() - b.start.getTime());
    const runs = [];
    let run = [];
    for (const s of sorted) {
      if (run.length === 0) {
        run.push(s);
      } else {
        const last = run[run.length - 1];
        const contiguous =
          last.availabilityId === s.availabilityId &&
          approxSameInstant(last.end.getTime(), s.start.getTime());
        if (contiguous) run.push(s);
        else {
          runs.push(run);
          run = [s];
        }
      }
    }
    if (run.length) runs.push(run);
    return [day, runs];
  });
}

/** Local midnight for a calendar day (used for admin “copy pattern” math). */
function localMidnight(d) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

/** Whole calendar days from `fromDay` to `toDay` (local dates, signed). */
function calendarDaysDelta(fromDay, toDay) {
  const a = localMidnight(fromDay);
  const b = localMidnight(toDay);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Move a wall-clock instant by N calendar days (handles DST better than +N×24h). */
function shiftDateByCalendarDays(date, deltaDays) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + deltaDays,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds()
  );
}

/**
 * Same start/end clock times as the template block, on `targetDay`’s calendar date (local).
 * `targetDay` may be any instant on that day.
 */
function projectAvailabilityToLocalDay(sourceStart, sourceEnd, targetDay) {
  const s0 = sourceStart?.toDate ? sourceStart.toDate() : new Date(sourceStart);
  const e0 = sourceEnd?.toDate ? sourceEnd.toDate() : new Date(sourceEnd);
  const delta = calendarDaysDelta(s0, localMidnight(targetDay));
  return {
    start: shiftDateByCalendarDays(s0, delta),
    end: shiftDateByCalendarDays(e0, delta),
  };
}

/** Yield local midnights from first to last day inclusive. */
function* eachLocalCalendarDayInclusive(firstDay, lastDay) {
  let cur = localMidnight(firstDay);
  const end = localMidnight(lastDay);
  if (cur > end) return;
  while (true) {
    yield new Date(cur);
    if (cur.getTime() >= end.getTime()) break;
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
}

function slotDurationMinutes(slot) {
  return (slot.end.getTime() - slot.start.getTime()) / 60000;
}

/**
 * In a contiguous run of expanded slots, find start times that support at least `durationMinutes`.
 */
function findBookableRangesInRun(runSlots, durationMinutes) {
  if (!runSlots?.length || durationMinutes < 1) return [];
  const out = [];
  for (let i = 0; i < runSlots.length; i++) {
    const lo = runSlots[i];
    let totalMins = slotDurationMinutes(lo);
    let hi = lo;
    let j = i + 1;
    while (j < runSlots.length && totalMins < durationMinutes) {
      const prev = runSlots[j - 1];
      const next = runSlots[j];
      if (!approxSameInstant(prev.end.getTime(), next.start.getTime())) break;
      hi = next;
      totalMins += slotDurationMinutes(next);
      j++;
    }
    if (totalMins >= durationMinutes) {
      const end = new Date(lo.start.getTime() + durationMinutes * 60000);
      out.push({
        availabilityId: lo.availabilityId,
        start: lo.start,
        end,
        loSlot: lo,
        hiSlot: hi,
      });
    }
  }
  return out;
}

/** All bookable ranges of `durationMinutes` across grouped day runs. */
function bookableRangesForDuration(byDayAndRun, durationMinutes) {
  const out = [];
  for (const [, runs] of byDayAndRun) {
    for (const run of runs) {
      out.push(...findBookableRangesInRun(run, durationMinutes));
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export {
  expandSlots,
  splitTimeWindowIntoSlotChunks,
  slotKey,
  mergeContiguousSlotRange,
  contiguousSlotKeysInRange,
  dayKey,
  localDateFromDayKey,
  groupSlotsByDay,
  groupSlotsByDayContiguous,
  groupSlotsByDayAndRun,
  localMidnight,
  calendarDaysDelta,
  shiftDateByCalendarDays,
  projectAvailabilityToLocalDay,
  eachLocalCalendarDayInclusive,
  findBookableRangesInRun,
  bookableRangesForDuration,
  slotDurationMinutes,
};
