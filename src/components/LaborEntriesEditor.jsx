import Input from "./ui/Input";
import Btn from "./ui/Btn";

export const validLaborEntries = entries => (entries || []).every(entry =>
  entry.name?.trim() && String(entry.hours).trim() !== "" && Number.isFinite(Number(entry.hours)) && Number(entry.hours) > 0 &&
  String(entry.hourlyRate).trim() !== "" && Number.isFinite(Number(entry.hourlyRate)) && Number(entry.hourlyRate) >= 0);

export default function LaborEntriesEditor({ entries = [], onChange }) {
  const update = (index, key, value) => onChange(entries.map((entry, i) => i === index ? { ...entry, [key]: value } : entry));
  return <div style={{ marginBottom: 16 }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>Additional labor entries</div>
    <p style={{ fontSize: 12, color: "#7f8c8d" }}>Each entry appears separately on the same invoice. Use $0 for complimentary planning. “Two-person crew” means you and an assistant; enter elapsed hours and the combined hourly rate.</p>
    {entries.map((entry, index) => <div key={index} style={{ border: "1px solid #bdc3c7", borderRadius: 6, padding: 12, marginBottom: 10 }}>
      <Input label={`Labor description ${index + 1}`} value={entry.name} onChange={value => update(index, "name", value)} placeholder="e.g. Planning or Two-person crew" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <Input label={`Labor hours ${index + 1}`} value={entry.hours} type="number" onChange={value => update(index, "hours", value)} />
        <Input label={`Labor rate ${index + 1} ($/hr)`} value={entry.hourlyRate} type="number" onChange={value => update(index, "hourlyRate", value)} />
      </div>
      <Btn small danger onClick={() => onChange(entries.filter((_, i) => i !== index))}>Remove entry {index + 1}</Btn>
    </div>)}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {[["Planning", "0"], ["Standard labor", "75"], ["Two-person crew", "100"]].map(([name, hourlyRate]) => <Btn key={name} small onClick={() => onChange([...entries, { id: crypto.randomUUID(), name, hourlyRate, hours: "" }])}>Add {name.toLowerCase()}</Btn>)}
    </div>
    {!validLaborEntries(entries) && <p role="alert" style={{ color: "#c0392b", fontSize: 13 }}>Each labor entry needs a description, hours greater than zero, and a rate of zero or more.</p>}
  </div>;
}
