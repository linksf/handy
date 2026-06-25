import { initializeRecaptchaConfig } from "firebase/auth";

/** reCAPTCHA Enterprise site key (Firebase Console → Authentication → Settings). */
export const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_RECAPTCHA_SITE_KEY || "6LdDoussAAAAABWDcC-E6Z5pkV4pkmIjIsKP65KT";

let scriptLoadPromise = null;
let configPromise = null;

function loadRecaptchaEnterpriseScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.grecaptcha?.enterprise) return Promise.resolve();

  if (scriptLoadPromise) return scriptLoadPromise;

  const existing = document.querySelector("script[data-recaptcha-enterprise]");
  if (existing) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      if (window.grecaptcha?.enterprise) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("reCAPTCHA script failed to load")), {
        once: true,
      });
    });
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.defer = true;
    script.dataset.recaptchaEnterprise = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("reCAPTCHA Enterprise script failed to load"));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Load reCAPTCHA Enterprise and fetch Firebase Auth reCAPTCHA config.
 * Call once at app startup; auth hooks also await this before sign-in.
 */
export function initAuthRecaptcha(auth) {
  if (!auth || configPromise) return configPromise ?? Promise.resolve();

  configPromise = (async () => {
    await loadRecaptchaEnterpriseScript();
    await initializeRecaptchaConfig(auth);
  })();

  return configPromise;
}

/** Ensures reCAPTCHA is ready before a sign-in / sign-up attempt. */
export function ensureAuthRecaptcha(auth) {
  return initAuthRecaptcha(auth);
}
