export function formatBookingStatusMessage(req) {
  const status = req?.status;
  const start = req?.requestedStart?.toDate?.();
  const end = req?.requestedEnd?.toDate?.();

  if (req?.statusMessage) return req.statusMessage;

  const when =
    start && end
      ? `${start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : null;

  if (status === "pending") {
    return "Waiting for review. You'll see an update here when it's approved or declined.";
  }
  if (status === "approved") {
    return when
      ? `Approved — we'll see you ${when}.`
      : "Approved — your visit is confirmed.";
  }
  if (status === "declined") {
    return "This request was declined. You can submit a new request with a different time.";
  }
  return "";
}
