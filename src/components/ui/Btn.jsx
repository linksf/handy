export default function Btn({ children, onClick, color, small, danger, style }) {
  const bg = danger ? "#c0392b" : (color ?? "#f9bf3b");
  const textColor = danger ? "#fff" : (color ? "#fff" : "#232323");
  return (
    <button
      onClick={onClick}
      style={{
        background: bg,
        color: textColor,
        border: "none",
        borderRadius: 6,
        padding: small ? "8px 14px" : "11px 20px",
        minHeight: small ? 36 : 44,
        cursor: "pointer",
        fontSize: small ? 13 : 15,
        fontWeight: 600,
        letterSpacing: "0.01em",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
