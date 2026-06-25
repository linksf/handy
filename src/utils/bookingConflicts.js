/** Millisecond range overlap (half-open intervals). */
export function rangesOverlapMs(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export function bookingRequestRangeMs(req) {
  const start = req.requestedStart?.toMillis?.() ?? 0;
  const end = req.requestedEnd?.toMillis?.() ?? 0;
  return { start, end };
}

/** Returns the first conflicting pending/approved request, if any. */
export function findConflictingBooking(existing, startMs, endMs, { excludeId } = {}) {
  for (const req of existing) {
    if (excludeId && req.id === excludeId) continue;
    if (req.status !== "pending" && req.status !== "approved") continue;
    const { start, end } = bookingRequestRangeMs(req);
    if (rangesOverlapMs(startMs, endMs, start, end)) return req;
  }
  return null;
}

/** Availability row overlaps a booking time range. */
export function availabilityOverlapsBooking(row, startMs, endMs) {
  const rs = row.start?.toMillis?.() ?? 0;
  const re = row.end?.toMillis?.() ?? 0;
  return rangesOverlapMs(rs, re, startMs, endMs);
}

export function formatBookingConflictMessage() {
  return "That time was just booked by someone else. Pick another slot.";
}
