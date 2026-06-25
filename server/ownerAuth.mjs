/** Matches firestore.rules legacyOwnerEmailMatches(). */
function legacyOwnerEmailMatches(email) {
  const lower = email.toLowerCase();
  if (lower === "omnificology@gmail.com") return true;
  return /^o\.?m\.?n\.?i\.?f\.?i\.?c\.?o\.?l\.?o\.?g\.?y(\+[^@]*)?@(gmail|googlemail)\.com$/.test(lower);
}

export function isOwnerFromDecodedToken(decoded) {
  if (!decoded) return false;
  if (decoded.role === "owner") return true;
  const email = decoded.email;
  if (typeof email === "string" && legacyOwnerEmailMatches(email)) return true;
  return false;
}
