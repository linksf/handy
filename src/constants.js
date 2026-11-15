/**
 * Only this Google account may use the owner app at /admin (see useAuth allowlist).
 * Firestore owner checks also accept custom claim role "owner"; set via:
 *   npm run set-owner-claim -- you@example.com
 * (requires GOOGLE_APPLICATION_CREDENTIALS). See FIRESTORE_SCHEMA.md.
 */
export const ALLOWED_GOOGLE_EMAIL = "omnificology@gmail.com";

/** Booking app product name (admin shell, PWA title). */
export const APP_NAME = "Handy";

/** Business identity on invoices and customer-facing surfaces. */
export const BUSINESS_NAME = "Omnificology";

export const BUSINESS_SITE_URL = "https://omnificology.com";

export const BUSINESS_TAGLINE = "handyman services & custom fabrication";

/** Omnificology brand colors (aligned with omnificology.com). */
export const BRAND = {
  charcoal: "#1c1c1e",
  amber: "#f5b01b",
  amberDark: "#c28b15",
  stone: "#e8e4dc",
  stoneLight: "#f5f3ef",
  muted: "#666666",
};

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

/** Badge styling for incoming leads (webhook job requests / new clients). */
export const leadBadgeColor = { bg: "#fdebd0", tc: "#d35400" };

/**
 * A preliminary job request: a Draft job that arrived from a lead source
 * (e.g. Thumbtack webhook) and hasn't been scheduled/approved yet.
 */
export const isPreliminaryJob = (job) =>
  !!job && job.status === "Draft" && (job.source === "thumbtack" || !!job.leadInviteToken);

/** A customer created from an incoming lead that hasn't booked/linked yet. */
export const isPreliminaryCustomer = (customer) =>
  !!customer && customer.status === "preliminary";
