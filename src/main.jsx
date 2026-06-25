import { Component, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ClientApp from "./components/client/ClientApp";
import { authRecaptchaReady } from "./firebase";

function isAdminPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error("Root error boundary:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            minHeight: "100vh",
            boxSizing: "border-box",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            color: "#232323",
            background: "#f8f9fa",
          }}
        >
          <h1 style={{ fontSize: 20, marginTop: 0 }}>Something went wrong</h1>
          <p style={{ color: "#555", lineHeight: 1.5, marginBottom: 16 }}>
            The app hit an unexpected error. Try refreshing the page. If you were signing in, try once more
            or open the browser console (developer tools) for details.
          </p>
          <pre
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              overflow: "auto",
              fontSize: 13,
              color: "#c0392b",
            }}
          >
            {this.state.err?.message || String(this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return isAdminPath(path) ? <App /> : <ClientApp />;
}

authRecaptchaReady.finally(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <RootErrorBoundary>
        <Root />
      </RootErrorBoundary>
    </StrictMode>
  );
});

if ("serviceWorker" in navigator) {
  if (import.meta.env.DEV) {
    // Dev: stale cached JS from the PWA service worker breaks Vite HMR and causes
    // "Invalid hook call" (mixed React copies). Clear any prior registration.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    if (typeof caches !== "undefined") {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    }
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    });
  }
}
