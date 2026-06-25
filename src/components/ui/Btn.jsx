export default function Btn({ children, onClick, color, small, danger, style, type = "button", disabled }) {
  const bg = danger ? "#c0392b" : (color ?? "#f9bf3b");
  const textColor = danger ? "#fff" : (color ? "#fff" : "#232323");
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg,
        color: textColor,
        border: "none",
        borderRadius: 6,
        padding: small ? "8px 14px" : "11px 20px",
        minHeight: small ? 36 : 44,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
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
