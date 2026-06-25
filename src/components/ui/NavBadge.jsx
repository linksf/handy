/** Small count badge for nav icons (e.g. pending bookings). */
export default function NavBadge({ count }) {
  if (!count || count < 1) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={`${count} pending`}
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 9,
        background: "#e74c3c",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: "18px",
        textAlign: "center",
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    >
      {label}
    </span>
  );
}
