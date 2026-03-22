export default function Input({ label, value, onChange, type = "text", placeholder, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      {label && <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, color: "#232323", outline: "none", minHeight: 44 }}
      />
    </div>
  );
}
