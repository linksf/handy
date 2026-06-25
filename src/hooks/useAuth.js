import { useState, useEffect, useCallback } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, authRecaptchaReady } from "../firebase";
import { getGoogleEmailFromUser } from "../auth/allowlistEmail";
import { isOwnerFirebaseUser } from "../auth/isOwnerFirebaseUser";

function applyUserGate(u, setUser, setLoading, setAuthNotice, setBlockedFirebaseUser) {
  if (!u) {
    setUser(null);
    setBlockedFirebaseUser(null);
    setLoading(false);
    return;
  }

  const email = getGoogleEmailFromUser(u);
  if (!email) {
    u.reload()
      .then(() => {
        const after = auth.currentUser;
        if (!after) {
          setUser(null);
          setBlockedFirebaseUser(null);
          setLoading(false);
          return;
        }
        finishGate(after, setUser, setLoading, setAuthNotice, setBlockedFirebaseUser);
      })
      .catch(() => {
        setAuthNotice("Could not verify your Google account email. Try another browser or disable strict tracking protection.");
        setBlockedFirebaseUser(u);
        setUser(null);
        setLoading(false);
      });
    return;
  }

  finishGate(u, setUser, setLoading, setAuthNotice, setBlockedFirebaseUser);
}

function finishGate(u, setUser, setLoading, setAuthNotice, setBlockedFirebaseUser) {
  (async () => {
    try {
      if (await isOwnerFirebaseUser(u)) {
        setBlockedFirebaseUser(null);
        setAuthNotice(null);
        setUser(u);
        setLoading(false);
        return;
      }
    } catch (e) {
      console.error("Owner gate:", e);
    }
    setBlockedFirebaseUser(u);
    setAuthNotice(null);
    setUser(null);
    setLoading(false);
  })();
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState(null);
  const [blockedFirebaseUser, setBlockedFirebaseUser] = useState(null);

  useEffect(() => {
    let unsub = () => {};

    (async () => {
      try {
        await getRedirectResult(auth);
      } catch (err) {
        console.error("Google redirect sign-in error:", err);
      }

      unsub = onAuthStateChanged(auth, (u) => {
        applyUserGate(u, setUser, setLoading, setAuthNotice, setBlockedFirebaseUser);
      });
    })();

    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthNotice(null);
    await authRecaptchaReady;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    provider.addScope("email");
    provider.addScope("profile");
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = e?.code;
      if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
        await signInWithRedirect(auth, provider);
        return;
      }
      if (code === "auth/popup-closed-by-user") return;
      throw e;
    }
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  return { user, loading, signInWithGoogle, signOut, authNotice, blockedFirebaseUser };
}
