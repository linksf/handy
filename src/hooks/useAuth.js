import { useState, useEffect, useCallback } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth } from "../firebase";
import { ALLOWED_GOOGLE_EMAIL } from "../constants";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState(null);

  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      console.error("Google redirect sign-in error:", err);
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const email = (u.email || "").toLowerCase();
        if (email !== ALLOWED_GOOGLE_EMAIL) {
          await firebaseSignOut(auth);
          setAuthNotice(
            "This app is only for Omnificology@gmail.com. Please sign in with that Google account."
          );
          setUser(null);
          setLoading(false);
          return;
        }
        setAuthNotice(null);
        setUser(u);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(() => {
    setAuthNotice(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithRedirect(auth, provider);
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  return { user, loading, signInWithGoogle, signOut, authNotice };
}
