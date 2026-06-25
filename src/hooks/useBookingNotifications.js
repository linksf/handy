import { useEffect, useRef } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

function notify(title, body) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icons/android-icon-192x192.png" });
  } catch {
    /* ignore */
  }
}

/**
 * Browser notifications when the client's booking request status changes.
 */
export function useBookingNotifications(userId) {
  const initialRef = useRef(true);
  const statusByIdRef = useRef(new Map());

  useEffect(() => {
    if (!userId || typeof Notification === "undefined") return undefined;

    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const q = query(
      collection(db, "bookingRequests"),
      where("clientUid", "==", userId),
      orderBy("requestedStart", "desc")
    );

    return onSnapshot(q, (snap) => {
      if (initialRef.current) {
        for (const d of snap.docs) {
          statusByIdRef.current.set(d.id, d.data().status);
        }
        initialRef.current = false;
        return;
      }

      for (const d of snap.docs) {
        const data = d.data();
        const prev = statusByIdRef.current.get(d.id);
        statusByIdRef.current.set(d.id, data.status);
        if (prev === data.status) continue;

        if (data.status === "approved") {
          notify("Booking approved", data.statusMessage || "Your visit is confirmed.");
        } else if (data.status === "declined") {
          notify("Booking update", data.statusMessage || "Your request was declined.");
        }
      }
    });
  }, [userId]);
}
