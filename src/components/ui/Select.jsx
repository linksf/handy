export default function Select({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, background: "#fff", color: "#232323", outline: "none", minHeight: 44 }}
      >
        {options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </div>
  );
}
