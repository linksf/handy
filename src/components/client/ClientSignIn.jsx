import { useState } from "react";
import Btn from "../ui/Btn";
import Input from "../ui/Input";
import { authErrorMessage } from "../../auth/authErrors";
import { BUSINESS_NAME } from "../../constants";
import { clientFont, colors } from "./clientTheme";

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: "36px 32px",
  maxWidth: 420,
  width: "100%",
  boxShadow: "0 8px 24px rgba(35,35,35,0.12)",
};

const tabStyle = (active) => ({
  flex: 1,
  padding: "10px 12px",
  border: active ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
  borderRadius: 8,
  background: active ? colors.accentSoft : "#fff",
  cursor: "pointer",
  fontWeight: 600,
  fontFamily: "inherit",
  fontSize: 14,
  color: colors.text,
});

export default function ClientSignIn({
  onSignIn,
  onSignUp,
  onGoogleSignIn,
  leadInvite = false,
  onFindLead,
}) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [findName, setFindName] = useState("");
  const [findPhone, setFindPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const stashLeadLookup = () => {
    if (!onFindLead || !findPhone.trim()) return;
    onFindLead({ name: findName.trim(), phone: findPhone.trim() });
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError("Enter your email.");
      return;
    }
    if (password.length < 6) {
      setLocalError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      stashLeadLookup();
      if (mode === "signup") await onSignUp(email, password);
      else await onSignIn(email, password);
    } catch (err) {
      setLocalError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (!onGoogleSignIn) return;
    setLocalError(null);
    setGoogleBusy(true);
    try {
      stashLeadLookup();
      await onGoogleSignIn();
    } catch (err) {
      setLocalError(authErrorMessage(err, "Google sign-in failed. Try again."));
    } finally {
      setGoogleBusy(false);
    }
  };

  const disabled = busy || googleBusy;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: colors.bg,
        fontFamily: clientFont,
      }}
    >
      <div style={cardStyle}>
        <p
          style={{
            margin: "0 0 4px",
            fontSize: 12,
            fontWeight: 700,
            color: colors.mmuted,
            textAlign: "center",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {BUSINESS_NAME}
        </p>
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: colors.text, textAlign: "center" }}>
          {leadInvite ? "Finish your booking" : "Book a visit"}
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#555", lineHeight: 1.5, textAlign: "center" }}>
          {leadInvite
            ? "Sign in or create an account to confirm your details and pick a time."
            : "Sign in to request a time. You'll get an update once your request is reviewed."}
        </p>

        {onFindLead && !leadInvite ? (
          <div style={{ marginBottom: 20, padding: 14, background: colors.accentSoft, borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Have a Thumbtack request?
            </div>
            <Input label="Your name" value={findName} onChange={setFindName} placeholder="As on Thumbtack" />
            <Input label="Phone" type="tel" value={findPhone} onChange={setFindPhone} placeholder="Same number as Thumbtack" />
            <p style={{ margin: 0, fontSize: 12, color: colors.mmuted, lineHeight: 1.4 }}>
              Enter this before signing in — we'll find your open request after you log in.
            </p>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setLocalError(null);
            }}
            style={tabStyle(mode === "signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setLocalError(null);
            }}
            style={tabStyle(mode === "signup")}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleEmailSubmit}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          <Btn type="submit" style={{ width: "100%" }} disabled={disabled}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </Btn>
        </form>

        {localError && (
          <p style={{ margin: "16px 0 0", fontSize: 13, color: colors.danger, lineHeight: 1.45 }} role="alert">
            {localError}
          </p>
        )}

        {onGoogleSignIn && (
          <>
            <OrDivider />
            <button
              type="button"
              onClick={handleGoogle}
              disabled={disabled}
              style={{
                width: "100%",
                padding: "14px 20px",
                fontSize: 15,
                fontWeight: 600,
                border: "1px solid #dadce0",
                borderRadius: 8,
                background: "#fff",
                color: colors.text,
                cursor: disabled ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                fontFamily: "inherit",
              }}
            >
              <GoogleIcon />
              {googleBusy ? "Continuing…" : "Continue with Google"}
            </button>
          </>
        )}

        <p style={{ margin: "24px 0 0", fontSize: 12, color: colors.mmuted, textAlign: "center", lineHeight: 1.5 }}>
          Business owner?{" "}
          <a href="/admin" style={{ color: "#2980b9", fontWeight: 600 }}>
            Admin sign-in
          </a>
        </p>
      </div>
    </div>
  );
}

function OrDivider() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "24px 0 20px",
        color: colors.mmuted,
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1, height: 1, background: "#ecf0f1" }} />
      <span>or</span>
      <span style={{ flex: 1, height: 1, background: "#ecf0f1" }} />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.21 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-3.71-13.46-8.73l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
