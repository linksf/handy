import { dayOf } from "./finance.js";

export function paymentDateChange(payment, { jobId, invoiceId, date, expectedDate, reason }) {
  const previousDate = dayOf(payment.date || payment.occurredAt);
  if (payment.jobId !== jobId || (payment.invoiceId || "primary") !== invoiceId) throw new Error("Payment belongs to another invoice.");
  if (date === previousDate) return null;
  if (previousDate !== expectedDate) throw new Error("The payment date changed. Reload the payment before correcting it.");
  if (!reason.trim()) throw new Error("Enter a reason for the date correction.");
  return { previousDate, date, reason: reason.trim() };
}
