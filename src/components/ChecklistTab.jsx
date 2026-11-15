import { useState } from "react";
import { db } from "../firebase";
import { changeVisit } from "../utils/visitStore";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Card from "./ui/Card";

export default function ChecklistTab({ job, ctx, openTasks }) {
  const { getTool } = ctx;
  const visits = job.visits || [];
  const [visitId, setVisitId] = useState(visits.find(visit => visit.status === "scheduled")?.id || "");
  const [tool, setTool] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const visit = visits.find(item => item.id === visitId);
  const changePacking = async change => {
    setBusy(true);
    setFeedback("");
    try {
      await changeVisit(db, job.id, visitId, before => ({ ...before, packing: change(before?.packing || []) }), visit.revision || "");
      setFeedback("Packing list saved.");
      return true;
    } catch { setFeedback("Could not save packing item. Try again."); return false; }
    finally { setBusy(false); }
  };
  const [checked, setChecked] = useState({});
  const toggle = (key) => setChecked(c => ({ ...c, [key]: !c[key] }));

  // Build a flat list of unique tools across all tasks (deduplicated by toolId)
  const seenToolIds = new Set();
  const allTools = [];
  (job.tasks || []).forEach(t => {
    (t.toolIds || []).forEach(toolId => {
      if (!seenToolIds.has(toolId)) {
        seenToolIds.add(toolId);
        const tool = getTool(toolId);
        if (tool) allTools.push({ toolId, name: tool.name });
      }
    });
  });

  const allMats = (job.tasks || []).flatMap(t =>
    (t.materials || []).map(m => ({ ...m, task: t.name }))
  );

  const total = allTools.length + allMats.length;

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Packing checklist · {job.title}</h3>
      <div className="admin-action-row"><Btn onClick={openTasks}>Add a job task</Btn>
        {!visits.length && <Btn onClick={() => ctx.nav("visitEditor", [job.id, "new"])}>Schedule a visit</Btn>}</div>
      {!!visits.length && <section>
        <h4>Visit-specific tools</h4>
        <Select label="Packing visit" value={visitId} onChange={setVisitId}
          options={[{ value: "", label: "Select a visit" }, ...visits.map(item => ({ value: item.id, label: `${item.kind} · ${item.start?.slice(0, 10) || ""}` }))]} />
        {visit && <>
          {(visit.packing || []).map(item => <label className="packing-item" key={item.id}>
            <input type="checkbox" checked={!!item.packed} disabled={busy} onChange={() => changePacking(rows =>
              rows.map(row => row.id === item.id ? { ...row, packed: !row.packed } : row))} />
            {item.name} × {item.quantity}
          </label>)}
          <div className="admin-action-row">
            <Input label="One-off tool" value={tool} onChange={setTool} />
            <Input label="Quantity" type="number" value={quantity} onChange={setQuantity} />
            <Btn disabled={busy || !tool.trim() || !Number.isInteger(Number(quantity)) || Number(quantity) < 1} onClick={async () => {
              if (await changePacking(rows => [...rows, { id: crypto.randomUUID(), name: tool.trim(), quantity: Number(quantity), packed: false }])) setTool("");
            }}>Add tool</Btn>
          </div>
          {feedback && <p role="status">{feedback}</p>}
        </>}
      </section>}
      {total === 0 && (
        <p style={{ color: "#a0aec0" }}>No tools or materials added to tasks yet.</p>
      )}
      {allTools.length > 0 && (
        <>
          <div style={{ fontWeight: 700, marginBottom: 8, color: "#2d3748" }}>🔧 Tools</div>
          {allTools.map(({ toolId, name }) => (
            <label key={toolId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #ecf0f1", cursor: "pointer" }}>
              <input type="checkbox" checked={!!checked[toolId]} onChange={() => toggle(toolId)} style={{ width: 16, height: 16 }} />
              <span style={{ textDecoration: checked[toolId] ? "line-through" : "none", color: checked[toolId] ? "#a0aec0" : "inherit", fontSize: 14 }}>
                {name}
              </span>
            </label>
          ))}
        </>
      )}
      {allMats.length > 0 && (
        <>
          <div style={{ fontWeight: 700, margin: "16px 0 8px", color: "#2d3748" }}>📦 Materials</div>
          {allMats.map(m => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #ecf0f1", cursor: "pointer" }}>
              <input type="checkbox" checked={!!checked[m.id]} onChange={() => toggle(m.id)} style={{ width: 16, height: 16 }} />
              <span style={{ textDecoration: checked[m.id] ? "line-through" : "none", color: checked[m.id] ? "#a0aec0" : "inherit", fontSize: 14 }}>
                {m.name} {m.qty ? `× ${m.qty}${m.unit ? " " + m.unit : ""}` : ""}{" "}
                <span style={{ color: "#a0aec0", fontSize: 12 }}>({m.task})</span>
              </span>
            </label>
          ))}
        </>
      )}
      {total > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#7f8c8d" }}>
          {Object.values(checked).filter(Boolean).length} / {total} packed
        </div>
      )}
    </Card>
  );
}
