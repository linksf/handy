import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { canPromptInstall, decodeApplicationKey, installHandy, pushSupported, unsubscribeDevice, workerSupported } from "../utils/pwa";
import { offlineEnabled, trustedDeviceKey } from "../utils/offlinePreference";
import Btn from "./ui/Btn";

const synthetic = import.meta.env.HANDY_SYNTHETIC_PREVIEW;
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

export function OfflineNotice() {
  return useOnline() ? null : <div role="status" className="handy-offline-notice">
    Offline · Previously loaded records may be available. Live bookings, payments and provider requests need a connection.
  </div>;
}

export default function PwaSettings() {
  const [user, setUser] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(null);
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  const [installed, setInstalled] = useState(() => !!window.matchMedia?.("(display-mode: standalone)").matches || !!navigator.standalone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const online = useOnline();

  useEffect(() => {
    if (synthetic) return;
    return onAuthStateChanged(auth, setUser);
  }, []);
  useEffect(() => {
    const change = () => {
      setCanInstall(canPromptInstall());
      setInstalled(!!window.matchMedia?.("(display-mode: standalone)").matches || !!navigator.standalone);
    };
    window.addEventListener("handy-install", change);
    return () => window.removeEventListener("handy-install", change);
  }, []);
  useEffect(() => {
    if (!workerSupported()) return;
    let current = true;
    const refresh = async () => {
      try {
        const next = await navigator.serviceWorker.getRegistration("/");
        const device = await next?.pushManager?.getSubscription();
        if (current) { setRegistration(next || null); setSubscription(device || null); }
      } catch { if (current) setRegistration(null); }
    };
    window.addEventListener("handy-worker", refresh);
    void refresh();
    return () => { current = false; window.removeEventListener("handy-worker", refresh); };
  }, []);
  useEffect(() => {
    if (!user || !online || !pushSupported()) return;
    let current = true;
    httpsCallable(functions, "getDevicePushConfig")().then(({ data }) => {
      if (current) { setKey(data.publicKey || ""); setConfigured(!!data.publicKey); }
    }).catch(() => { if (current) setConfigured(false); });
    return () => { current = false; };
  }, [user?.uid, online]);
  const run = async action => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (err) { setError(err.message || "Device settings could not be updated."); }
    finally { setBusy(false); }
  };
  const update = () => {
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    registration.waiting?.postMessage({ type: "HANDY_UPDATE_NOW" });
  };
  const enable = () => run(async () => {
    // Permission must be requested directly from the user gesture on iOS.
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Allow notifications in this device’s settings to continue.");
    if (synthetic) {
      await registration.showNotification("Handy test notification", {
        body: "Notifications are enabled on this device.", icon: "/icons/android-icon-192x192.png",
        data: { url: "/admin/dashboard" }, tag: "handy-test",
      });
      setMessage("Test notification displayed.");
      return;
    }
    const device = subscription || await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: decodeApplicationKey(key),
    });
    try {
      await httpsCallable(functions, "registerDevicePush")({ subscription: device.toJSON() });
    } catch (err) { if (!subscription) await device.unsubscribe().catch(() => {}); throw err; }
    setSubscription(device); setMessage("Device notifications enabled.");
  });
  const trust = () => run(async () => {
    localStorage.setItem(trustedDeviceKey, "yes");
    window.location.reload();
  });
  const forget = () => run(async () => {
    localStorage.removeItem(trustedDeviceKey);
    await terminate(db);
    try { await clearIndexedDbPersistence(db); }
    catch { throw new Error("Close other Handy tabs, reload, and choose Clear offline records again."); }
    window.location.reload();
  });
  return <details id="handy-device-settings" className="handy-device-settings">
    <summary>Install and device settings{registration?.waiting ? " · Update available" : ""}</summary>
    {installed ? <p>Handy is running as an installed app.</p> :
      canInstall ? <Btn onClick={() => run(installHandy)}>Install Handy</Btn> :
        <p>On iPhone or iPad, open Handy in Safari and choose Share → Add to Home Screen. On desktop, use your browser’s install option when offered.</p>}
    {registration?.waiting && <Btn onClick={update}>Reload to update Handy</Btn>}
    {registration?.active && <p>Offline app shell ready on this device.</p>}
    {user && <section>
      <h3>Offline records</h3>
      <p>{offlineEnabled() ? "Previously loaded records are kept on this device." :
        "On a trusted device, save the records you open so they are available offline."}</p>
      {!offlineEnabled() && <Btn disabled={busy || !online} onClick={trust}>Keep records on this device</Btn>}
      <button type="button" className="admin-quiet" disabled={busy} onClick={forget}>Clear offline records</button>
    </section>}
    {(user || synthetic) && <section>
      <h3>Device notifications</h3>
      {!pushSupported() && <p>Open Handy on a supported browser or install it on the iPhone Home Screen first.</p>}
      {configured === false && <p>Push setup is unavailable on the server.</p>}
      {pushSupported() && !!registration?.active && (synthetic || key) && <>
        <Btn disabled={busy || (!synthetic && !online)} onClick={enable}>{synthetic ? "Show test notification" : subscription ? "Refresh notifications" : "Enable notifications"}</Btn>
        {subscription && !synthetic && <button type="button" className="admin-quiet" disabled={busy} onClick={() => run(async () => {
          await unsubscribeDevice(); setSubscription(null); setMessage("Device notifications disabled.");
        })}>Disable notifications</button>}
      </>}
    </section>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </details>;
}
