import { unsubscribeDevice } from "../utils/pwa";
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
    void getRedirectResult(auth).catch(err => console.warn("Client Google redirect sign-in", err.code));
    return onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
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

  const signOut = useCallback(async () => {
    try { await unsubscribeDevice(); }
    catch { /* Generic push messages cannot expose account records after sign-out. */ }
    await firebaseSignOut(auth);
  }, []);

  return {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
  };
}
