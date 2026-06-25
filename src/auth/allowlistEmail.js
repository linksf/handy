/** Email shown on Google / Firebase user (falls back to Google provider entry). */
export function getGoogleEmailFromUser(user) {
  if (!user) return "";
  const direct = (user.email || "").trim();
  if (direct) return direct;
  const google = (user.providerData || []).find((p) => p.providerId === "google.com");
  return (google?.email || "").trim();
}

/**
 * Gmail treats dots in the local part as equivalent and ignores +tags.
 * Used so "om.nificology@gmail.com" matches allowlisted omnificology@gmail.com.
 */
export function normalizeEmailForAllowlist(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e.includes("@")) return e;
  const at = e.lastIndexOf("@");
  const local = e.slice(0, at);
  let domain = e.slice(at + 1).toLowerCase();
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const base = (local.split("+")[0] || "").replace(/\./g, "");
    return `${base}@gmail.com`;
  }
  return e;
}

export function isEmailAllowlisted(signedInEmail, allowedEmail) {
  return (
    normalizeEmailForAllowlist(signedInEmail) === normalizeEmailForAllowlist(allowedEmail)
  );
}
