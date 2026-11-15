import { Component, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ClientApp from "./components/client/ClientApp";
import PwaSettings, { OfflineNotice } from "./components/PwaSettings";
import { startPwa, watchInstallPrompt } from "./utils/pwa";
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
  return <>
    <OfflineNotice />
    {isAdminPath(path) ? <App /> : <ClientApp />}
    <PwaSettings />
    <footer style={{ padding: "20px 24px", textAlign: "center", background: "#ecf0f1", color: "#232323", fontFamily: "'Futura', 'Trebuchet MS', sans-serif", fontSize: 14 }}>
      <nav aria-label="Legal"><a href="/privacy" style={{ color: "#206493", marginRight: 24 }}>Privacy Policy</a><a href="/terms" style={{ color: "#206493" }}>Terms of Service</a></nav>
    </footer>
  </>;
}

watchInstallPrompt();
startPwa();

// Authentication restores from the SDK cache independently of reCAPTCHA setup.
void authRecaptchaReady;
createRoot(document.getElementById("root")).render(
  <StrictMode><RootErrorBoundary><Root /></RootErrorBoundary></StrictMode>
);

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistration("/").then(registration => registration?.unregister());
}
