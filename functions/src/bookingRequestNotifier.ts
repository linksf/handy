import * as admin from "firebase-admin";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {deliverDeviceNotice, pushKeys} from "./devicePush";
import * as logger from "firebase-functions/logger";

if (!admin.apps.length) {
  admin.initializeApp();
}

function formatWhen(start: admin.firestore.Timestamp, end: admin.firestore.Timestamp): string {
  const s = start.toDate();
  const e = end.toDate();
  const date = s.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const timeEnd = e.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"});
  return `${date} – ${timeEnd}`;
}

function statusMessageFor(status: string, start?: admin.firestore.Timestamp, end?: admin.firestore.Timestamp): string {
  if (status === "approved" && start && end) {
    return `Your booking was approved. We'll see you ${formatWhen(start, end)}.`;
  }
  if (status === "approved") {
    return "Your booking was approved.";
  }
  if (status === "declined") {
    return "Your booking request was declined. Please pick another time on the home page.";
  }
  return "";
}

/** Renamed from onBookingRequestStatusChange (was deployed as HTTPS; cannot change trigger type in place). */
export const bookingRequestStatusNotifier = onDocumentUpdated(
  {document: "bookingRequests/{requestId}", secrets: [pushKeys]},
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === after.status) return;

    const message = statusMessageFor(
      String(after.status || ""),
      after.requestedStart as admin.firestore.Timestamp | undefined,
      after.requestedEnd as admin.firestore.Timestamp | undefined
    );
    if (!message) return;

    await event.data?.after.ref.update({
      statusMessage: message,
      statusNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (typeof after.clientUid === "string" && after.clientUid) {
      try {
        await deliverDeviceNotice("uid", after.clientUid, {
          title: "Handy booking update", body: "Open Handy to see your booking status.",
          url: "/profile", tag: `booking-${event.params.requestId}`,
        });
      } catch { logger.warn("Booking Web Push unavailable"); }
    }

    logger.info("Booking status changed", {
      requestId: event.params.requestId,
      clientUid: after.clientUid,
      status: after.status,
    });
  }
);
