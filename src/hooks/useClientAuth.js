import { useState, useEffect, useCallback } from "react";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, authRecaptchaReady } from "../firebase";

/**
 * Auth for the client app (/, /profile): email/password or Google.
 */
export function useClientAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        await getRedirectResult(auth);
      } catch (err) {
        console.error("Client Google redirect sign-in error:", err);
      }
      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      });
    })();
    return () => unsub();
  }, []);

  const signIn = useCallback(async (email, password) => {
    await authRecaptchaReady;
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signUp = useCallback(async (email, password) => {
    await authRecaptchaReady;
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
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

  return {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
  };
}
