import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export const workerSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
export const pushSupported = () => workerSupported() && "PushManager" in window && "Notification" in window;

let installPrompt;
export function watchInstallPrompt() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    window.dispatchEvent(new Event("handy-install"));
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    window.dispatchEvent(new Event("handy-install"));
  });
}
export const canPromptInstall = () => !!installPrompt;
export async function installHandy() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  try { await prompt.prompt(); }
  finally { window.dispatchEvent(new Event("handy-install")); }
}

export function startPwa() {
  if (!workerSupported() || import.meta.env.DEV) return;
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => {
    const announce = () => window.dispatchEvent(new Event("handy-worker"));
    announce();
    registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", announce));
    navigator.serviceWorker.addEventListener("controllerchange", announce);
  }).catch(error => console.warn("Handy service worker unavailable", error));
}

export function decodeApplicationKey(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), char => char.charCodeAt(0));
}

export async function unsubscribeDevice() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  if (navigator.onLine && !import.meta.env.HANDY_SYNTHETIC_PREVIEW) {
    await httpsCallable(functions, "removeDevicePush")({ endpoint: subscription.endpoint });
  }
}
