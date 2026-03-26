import { useState } from "react";

export default function SignInScreen({ onSignIn, notice }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = async () => {
    setError(null);
    setBusy(true);
    try {
      await onSignIn();
    } catch (e) {
      setError(e?.message || "Sign-in failed. Try again.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#ecf0f1",
        fontFamily: "'Futura', 'Trebuchet MS', 'Century Gothic', sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "40px 36px",
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 8px 24px rgba(35,35,35,0.12)",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#232323" }}>
          Omnificology
        </h1>
        <p style={{ margin: "0 0 28px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
          Sign in with the Omnificology@gmail.com Google account. Your session stays on this device until you sign out.
        </p>
        {notice && (
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#c0392b", lineHeight: 1.45 }} role="alert">
            {notice}
          </p>
        )}
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          style={{
            width: "100%",
            padding: "14px 20px",
            fontSize: 15,
            fontWeight: 600,
            border: "1px solid #dadce0",
            borderRadius: 8,
            background: "#fff",
            color: "#232323",
            cursor: busy ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            fontFamily: "inherit",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.21 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-3.71-13.46-8.73l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {busy ? "Continuing…" : "Continue with Google"}
        </button>
        {error && (
          <p style={{ margin: "16px 0 0", fontSize: 13, color: "#c0392b" }} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
