/**
 * Only this Google account may use the owner app at /admin (see useAuth allowlist).
 * Firestore owner checks also accept custom claim role "owner"; set via:
 *   npm run set-owner-claim -- you@example.com
 * (requires GOOGLE_APPLICATION_CREDENTIALS). See FIRESTORE_SCHEMA.md.
 */
export const ALLOWED_GOOGLE_EMAIL = "omnificology@gmail.com";

/** Shown on generated PDF invoices. */
export const BUSINESS_NAME = "Handy";

export const STATUSES = ["Draft", "Scheduled", "In Progress", "Complete", "Cancelled"];
export const PAY_STATUSES = ["Unpaid", "Partial", "Paid"];

export const statusColor = {
  Draft:        { bg: "#e8daef", tc: "#7d3c98" },
  Scheduled:    { bg: "#d6eaf8", tc: "#2980b9" },
  "In Progress":{ bg: "#fef9e7", tc: "#f39c12" },
  Complete:     { bg: "#d5f5e3", tc: "#27ae60" },
  Cancelled:    { bg: "#fadbd8", tc: "#c0392b" },
};

export const payColor = {
  Unpaid:  { bg: "#fadbd8", tc: "#c0392b" },
  Partial: { bg: "#fef9e7", tc: "#f39c12" },
  Paid:    { bg: "#d5f5e3", tc: "#27ae60" },
};
