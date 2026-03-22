import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import ConfirmModal from "./ui/ConfirmModal";

export default function ToolsManager({ ctx }) {
  const { tools, addTool, deleteTool } = ctx;
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    addTool(name.trim());
    setName("");
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Tools</h2>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Tool name..."
            style={{ flex: 1, border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
          />
          <Btn onClick={handleAdd}>Add Tool</Btn>
        </div>
      </Card>
      {tools.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No tools yet. Add one above.</p></Card>
      ) : (
        tools.sort((a, b) => a.name.localeCompare(b.name)).map(tool => (
          <Card key={tool.id} style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>{tool.name}</span>
            <Btn small danger onClick={() => setConfirm({ message: `Delete "${tool.name}"?`, onConfirm: () => deleteTool(tool.id) })}>Delete</Btn>
          </Card>
        ))
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
