import { useState } from "react";
import Btn from "./ui/Btn";
import { uid } from "../utils";
import { useMobile } from "../hooks/useMobile";

export default function TaskEditor({ task, updateTask, getTool }) {
  const isMobile = useMobile();
  const [newMat, setNewMat] = useState({ name: "", qty: "", unit: "", cost: "", reimbursable: false });

  const addMat = () => {
    if (!newMat.name.trim()) return;
    updateTask({ ...task, materials: [...(task.materials || []), { id: uid(), ...newMat }] });
    setNewMat({ name: "", qty: "", unit: "", cost: "", reimbursable: false });
  };
  const removeMat = (id) => updateTask({ ...task, materials: task.materials.filter(m => m.id !== id) });

  const taskCost = (task.materials || []).reduce(
    (s, m) => s + (parseFloat(m.cost) || 0) * (parseFloat(m.qty) || 1), 0
  );

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #ecf0f1", paddingTop: 12 }}>
      <div style={{ marginBottom: 10, fontSize: 13, color: "#7f8c8d" }}>
        Materials cost: <strong>${taskCost.toFixed(2)}</strong>
      </div>

      {/* Tools — read-only, assigned via task definition */}
      {(task.toolIds || []).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>🔧 Tools</div>
          {(task.toolIds || []).map(toolId => {
            const tool = getTool(toolId);
            return (
              <div key={toolId} style={{ background: "#f7fafc", borderRadius: 6, padding: "5px 10px", marginBottom: 4, fontSize: 13, color: "#2d3748" }}>
                {tool ? tool.name : <span style={{ color: "#a0aec0" }}>Unknown tool</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Materials */}
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>📦 Materials</div>
      {(task.materials || []).map(m => (
        <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f7fafc", borderRadius: 6, padding: "5px 10px", marginBottom: 4, fontSize: 13 }}>
          <div>
            <span>{m.name} {m.qty ? `× ${m.qty}${m.unit ? " " + m.unit : ""}` : ""}</span>
            {m.reimbursable && <span style={{ marginLeft: 6, background: "#d5f5e3", color: "#27ae60", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>Reimbursable</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#7f8c8d" }}>${((parseFloat(m.cost) || 0) * (parseFloat(m.qty) || 1)).toFixed(2)}</span>
            <button onClick={() => removeMat(m.id)} style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        </div>
      ))}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={newMat.name} onChange={e => setNewMat(x => ({ ...x, name: e.target.value }))} placeholder="Material name" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <input value={newMat.qty} onChange={e => setNewMat(x => ({ ...x, qty: e.target.value }))} placeholder="Qty" type="number" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 8px", fontSize: 16 }} />
            <input value={newMat.unit} onChange={e => setNewMat(x => ({ ...x, unit: e.target.value }))} placeholder="Unit" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 8px", fontSize: 16 }} />
            <input value={newMat.cost} onChange={e => setNewMat(x => ({ ...x, cost: e.target.value }))} placeholder="$/unit" type="number" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 8px", fontSize: 16 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={newMat.reimbursable} onChange={e => setNewMat(x => ({ ...x, reimbursable: e.target.checked }))} style={{ width: 15, height: 15 }} />
              Reimbursable
            </label>
            <Btn small onClick={addMat}>Add</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newMat.name} onChange={e => setNewMat(x => ({ ...x, name: e.target.value }))} placeholder="Material" style={{ flex: 2, minWidth: 80, border: "1px solid #bdc3c7", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
          <input value={newMat.qty} onChange={e => setNewMat(x => ({ ...x, qty: e.target.value }))} placeholder="Qty" type="number" style={{ flex: 1, minWidth: 50, border: "1px solid #bdc3c7", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
          <input value={newMat.unit} onChange={e => setNewMat(x => ({ ...x, unit: e.target.value }))} placeholder="Unit" style={{ flex: 1, minWidth: 50, border: "1px solid #bdc3c7", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
          <input value={newMat.cost} onChange={e => setNewMat(x => ({ ...x, cost: e.target.value }))} placeholder="$/unit" type="number" style={{ flex: 1, minWidth: 50, border: "1px solid #bdc3c7", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={newMat.reimbursable} onChange={e => setNewMat(x => ({ ...x, reimbursable: e.target.checked }))} />
            Reimb.
          </label>
          <Btn small onClick={addMat}>Add</Btn>
        </div>
      )}
    </div>
  );
}
