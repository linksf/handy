import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Firestore doc clientProfiles/{uid} — displayName, address, phone.
 */
export function useClientProfile(uid) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const ref = doc(db, "clientProfiles", uid);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) setProfile(null);
        else setProfile(snap.data());
        setLoading(false);
      },
      (err) => {
        console.error("clientProfiles listener", err);
        setLoading(false);
      }
    );
  }, [uid]);

  const saveProfile = useCallback(
    async ({ displayName, address, phone }) => {
      if (!uid) return;
      const ref = doc(db, "clientProfiles", uid);
      await setDoc(
        ref,
        {
          displayName: (displayName || "").trim(),
          address: (address || "").trim(),
          phone: (phone || "").trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [uid]
  );

  return { profile, loading, saveProfile };
}
