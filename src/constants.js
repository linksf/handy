/** Only this Google account may use the app (compare lowercase in code). */
export const ALLOWED_GOOGLE_EMAIL = "omnificology@gmail.com";

export const STATUSES = ["Scheduled", "In Progress", "Complete", "Cancelled"];
export const PAY_STATUSES = ["Unpaid", "Partial", "Paid"];

export const statusColor = {
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
