/** Digits only; US numbers use last 10 digits for matching. */
export function normalizePhoneDigits(s) {
  const d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.slice(-10);
}
