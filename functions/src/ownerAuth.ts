import type {CallableRequest} from "firebase-functions/v2/https";

/** Matches firestore.rules legacyOwnerEmailMatches(). */
function legacyOwnerEmailMatches(email: string): boolean {
  const lower = email.toLowerCase();
  if (lower === "omnificology@gmail.com") return true;
  return /^o\.?m\.?n\.?i\.?f\.?i\.?c\.?o\.?l\.?o\.?g\.?y(\+[^@]*)?@(gmail|googlemail)\.com$/.test(lower);
}

export function isOwnerAuth(auth: CallableRequest["auth"]): boolean {
  if (!auth) return false;
  if (auth.token.role === "owner") return true;
  const email = auth.token.email;
  if (typeof email === "string" && legacyOwnerEmailMatches(email)) return true;
  return false;
}
