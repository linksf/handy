export default function Badge({ text, color = "#ebf4ff", textColor = "#2b6cb0" }) {
  return (
    <span style={{ background: color, color: textColor, borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
      {text}
    </span>
  );
}
