import { useState } from "react";
import Card from "./ui/Card";

export default function ChecklistTab({ job, ctx }) {
  const { getTool } = ctx;
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
      <h3 style={{ marginTop: 0 }}>📦 Packing Checklist — {job.title}</h3>
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
