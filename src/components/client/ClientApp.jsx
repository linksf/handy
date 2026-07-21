import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useClientAuth } from "../../hooks/useClientAuth";
import { useClientProfile } from "../../hooks/useClientProfile";
import { useBookingNotifications } from "../../hooks/useBookingNotifications";
import { useMobile } from "../../hooks/useMobile";
import { isOwnerFirebaseUser } from "../../auth/isOwnerFirebaseUser";
import { BUSINESS_NAME } from "../../constants";
import ClientSignIn from "./ClientSignIn";
import ClientBookingFlow from "./ClientBookingFlow";
import ClientGuestInquiry from "./ClientGuestInquiry";
import ClientLeadFlow from "./ClientLeadFlow";
import ClientProfile from "./ClientProfile";
import { clientFont, colors } from "./clientTheme";
import { functions } from "../../firebase";

function parseClientRoute(pathname) {
  const p = pathname.replace(/\/$/, "") || "/";
  const leadMatch = p.match(/^\/book\/lead\/([^/]+)$/);
  if (leadMatch) return { kind: "lead", token: decodeURIComponent(leadMatch[1]) };
  if (p === "/inquire") return { kind: "guest" };
  if (p === "/profile" || p === "/book/profile") return { kind: "profile" };
  return { kind: "book" };
}

export default function ClientApp() {
  const { user, loading, signIn, signUp, signInWithGoogle, signOut } = useClientAuth();
  const isMobile = useMobile();
  const { profile, loading: profileLoading, saveProfile } = useClientProfile(user?.uid);
  useBookingNotifications(user?.uid);
  const [route, setRoute] = useState(() => parseClientRoute(window.location.pathname));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [ownerGateReady, setOwnerGateReady] = useState(false);
  const [leadLookupError, setLeadLookupError] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const pendingLeadLookup = useRef(sessionStorage.getItem("pendingLeadLookup"));
  const pendingInquiryLink = useRef(sessionStorage.getItem("pendingInquiryLink"));

  useEffect(() => {
    if (!user) {
      setOwnerGateReady(false);
      setLeadLookupError(null);
      return undefined;
    }
    let cancelled = false;
    setOwnerGateReady(false);
    (async () => {
      try {
        if (await isOwnerFirebaseUser(user)) {
          if (!cancelled) window.location.replace("/admin");
          return;
        }
      } catch (e) {
        console.error("Client owner redirect check:", e);
      }
      if (!cancelled) setOwnerGateReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const onPop = () => setRoute(parseClientRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountMenuOpen]);

  /** Best-effort link of a guest inquiry after account authentication. */
  useEffect(() => {
    if (!user?.uid || !ownerGateReady) return;
    const raw = pendingInquiryLink.current ||
      sessionStorage.getItem("pendingInquiryLink");
    if (!raw) return;
    pendingInquiryLink.current = null;
    let cancelled = false;
    (async () => {
      try {
        const payload = JSON.parse(raw);
        const linkInquiry = httpsCallable(functions, "linkInquiryToClient");
        await linkInquiry({
          inquiryId: payload.inquiryId,
          customerId: payload.customerId,
        });
        if (!cancelled) sessionStorage.removeItem("pendingInquiryLink");
      } catch (err) {
        console.error("Guest inquiry linking failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, ownerGateReady]);

  /** After sign-in, match an open Thumbtack lead by Customer ID. */
  useEffect(() => {
    if (!user?.uid || !ownerGateReady || route.kind === "lead") return;
    const raw = pendingLeadLookup.current;
    if (!raw) {
      setLeadLookupError(null);
      return;
    }
    pendingLeadLookup.current = null;
    sessionStorage.removeItem("pendingLeadLookup");
    let cancelled = false;
    (async () => {
      try {
        setLeadLookupError(null);
        const payload = JSON.parse(raw);
        const matchLead = httpsCallable(functions, "matchLeadInvite");
        const res = await matchLead({
          thumbtackCustomerId: payload.thumbtackCustomerId,
        });
        if (cancelled) return;
        if (res.data?.found && res.data?.token) {
          const url = `/book/lead/${encodeURIComponent(res.data.token)}`;
          window.history.pushState({}, "", url);
          setRoute(parseClientRoute(url));
        } else {
          setLeadLookupError("No open request found for that Customer ID.");
        }
      } catch (err) {
        console.error("Lead lookup failed:", err);
        if (!cancelled) {
          setLeadLookupError(
            err?.message || "We couldn't look up that Customer ID. Try again.",
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, ownerGateReady, route.kind]);

  const go = useCallback((kind) => {
    const url = kind === "profile" ? "/profile" : "/";
    window.history.pushState({}, "", url);
    setRoute(parseClientRoute(url));
  }, []);

  const goToGuestInquiry = useCallback(() => {
    const url = "/inquire";
    window.history.pushState({}, "", url);
    setRoute(parseClientRoute(url));
  }, []);

  const goToAuth = useCallback((mode = "signin") => {
    setAuthMode(mode);
    const url = "/";
    window.history.pushState({}, "", url);
    setRoute(parseClientRoute(url));
  }, []);

  useEffect(() => {
    const p = window.location.pathname.replace(/\/$/, "") || "/";
    if (p === "/book") window.history.replaceState({}, "", "/");
    else if (p === "/book/profile") window.history.replaceState({}, "", "/profile");
  }, []);

  const leadToken = route.kind === "lead" ? route.token : null;
  const showLeadFlow = Boolean(leadToken && user && ownerGateReady);

  if (loading) {
    return (
      <div style={loadingScreenStyle}>
        <LoadingSpinner />
      </div>
    );
  }

  if (!user) {
    if (route.kind === "guest") {
      return (
        <ClientGuestInquiry
          onSignIn={() => goToAuth("signin")}
          onCreateAccount={() => goToAuth("signup")}
        />
      );
    }
    return (
      <ClientSignIn
        initialMode={authMode}
        onSignIn={signIn}
        onSignUp={signUp}
        onGoogleSignIn={signInWithGoogle}
        leadInvite={Boolean(leadToken)}
        onFindLead={(payload) => {
          sessionStorage.setItem("pendingLeadLookup", JSON.stringify(payload));
          pendingLeadLookup.current = JSON.stringify(payload);
        }}
        onContinueAsGuest={goToGuestInquiry}
      />
    );
  }

  if (!ownerGateReady) {
    return (
      <div style={loadingScreenStyle}>
        <LoadingSpinner />
      </div>
    );
  }

  const tabBtn = (active, label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? colors.accent : "transparent",
        border: "none",
        color: active ? colors.text : "#ecf0f1",
        padding: "10px 14px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  const accountDropdown = accountMenuOpen && (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: "100%",
        marginTop: 8,
        minWidth: 220,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 3000,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #ecf0f1", maxWidth: 280 }}>
        <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 4 }}>Signed in</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#232323", wordBreak: "break-word" }}>
          {user.displayName || user.email || user.uid}
        </div>
        {user.email && user.displayName ? (
          <div style={{ fontSize: 12, color: "#555", marginTop: 6, wordBreak: "break-all" }}>{user.email}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          setAccountMenuOpen(false);
          signOut();
        }}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          border: "none",
          background: "#fff",
          fontSize: 14,
          fontWeight: 600,
          color: "#c0392b",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Sign out
      </button>
    </div>
  );

  const hamburger = (
    <button
      type="button"
      aria-label={accountMenuOpen ? "Close account menu" : "Open account menu"}
      aria-expanded={accountMenuOpen}
      onClick={() => setAccountMenuOpen((o) => !o)}
      style={{
        background: colors.accent,
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 5,
        width: 44,
        height: 44,
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <span style={{ display: "block", width: 20, height: 3, background: "#232323", borderRadius: 1 }} />
      <span style={{ display: "block", width: 20, height: 3, background: "#232323", borderRadius: 1 }} />
      <span style={{ display: "block", width: 20, height: 3, background: "#232323", borderRadius: 1 }} />
    </button>
  );

  return (
    <div
      style={{
        fontFamily: clientFont,
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
      }}
    >
      <nav
        style={{
          background: colors.nav,
          color: "#ecf0f1",
          padding: isMobile ? "10px 12px" : "10px 16px",
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 10 : 8,
          flexWrap: "nowrap",
        }}
      >
        {isMobile ? (
          <>
            <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 10, minHeight: 44 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {BUSINESS_NAME}
              </span>
              <div ref={accountMenuRef} style={{ position: "relative", flexShrink: 0 }}>
                {hamburger}
                {accountDropdown}
              </div>
            </div>
            {!showLeadFlow ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  overflowX: "auto",
                  width: "100%",
                  WebkitOverflowScrolling: "touch",
                  borderTop: "1px solid rgba(255,255,255,0.2)",
                  paddingTop: 8,
                  gap: 6,
                }}
              >
                {tabBtn(route.kind === "book", "Request time", () => go("book"))}
                {tabBtn(route.kind === "profile", "Profile", () => go("profile"))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <span style={{ fontWeight: 700, fontSize: 15, marginRight: 8, flexShrink: 0 }}>{BUSINESS_NAME}</span>
            {!showLeadFlow ? (
              <>
                {tabBtn(route.kind === "book", "Request time", () => go("book"))}
                {tabBtn(route.kind === "profile", "Profile", () => go("profile"))}
              </>
            ) : (
              <span style={{ fontSize: 13, opacity: 0.9 }}>Complete your request</span>
            )}
            <div ref={accountMenuRef} style={{ marginLeft: "auto", position: "relative", flexShrink: 0 }}>
              {hamburger}
              {accountDropdown}
            </div>
          </>
        )}
      </nav>

      {leadLookupError && (
        <p
          role="alert"
          style={{
            margin: "16px auto 0",
            maxWidth: 760,
            padding: "12px 16px",
            border: `1px solid ${colors.danger}`,
            borderRadius: 8,
            background: "#fff",
            color: colors.danger,
            fontSize: 14,
          }}
        >
          {leadLookupError}
        </p>
      )}

      {showLeadFlow ? (
        <ClientLeadFlow
          token={leadToken}
          user={user}
          profile={profile}
          profileLoading={profileLoading}
          saveProfile={saveProfile}
        />
      ) : route.kind === "profile" ? (
        <ClientProfile
          user={user}
          profile={profile}
          profileLoading={profileLoading}
          saveProfile={saveProfile}
        />
      ) : (
        <ClientBookingFlow user={user} profile={profile} profileLoading={profileLoading} />
      )}
    </div>
  );
}

const loadingScreenStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  background: colors.bg,
  fontFamily: clientFont,
  color: colors.text,
  fontSize: 15,
};

function LoadingSpinner() {
  return (
    <>
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: "50%",
          animation: "clientSpin 0.8s linear infinite",
        }}
      />
      <span>Loading…</span>
      <style>{`@keyframes clientSpin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
