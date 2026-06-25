import { useMemo, useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import ConfirmModal from "./ui/ConfirmModal";
import { TOOL_CATEGORIES } from "../toolCatalog";

export default function ToolsManager({ ctx }) {
  const { tools, addTool, addToolsBulk, updateTool, deleteTool } = ctx;
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    if (category) {
      addToolsBulk([{ name: name.trim(), category }]);
    } else {
      addTool(name.trim());
    }
    setName("");
    setCategory("");
  };

  const toolsWithNormalizedCategory = useMemo(() => (
    tools.map((tool) => ({ ...tool, category: (tool.category || "").trim() }))
  ), [tools]);

  const uncategorizedCount = toolsWithNormalizedCategory.filter((t) => !t.category).length;

  const visibleTools = useMemo(() => {
    let list = [...toolsWithNormalizedCategory];
    if (showUncategorizedOnly) list = list.filter((tool) => !tool.category);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [toolsWithNormalizedCategory, showUncategorizedOnly]);

  const groupedTools = useMemo(() => {
    const groups = visibleTools.reduce((acc, tool) => {
      const key = tool.category || "Uncategorized";
      if (!acc[key]) acc[key] = [];
      acc[key].push(tool);
      return acc;
    }, {});
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "Uncategorized") return -1;
      if (b === "Uncategorized") return 1;
      return a.localeCompare(b);
    });
  }, [visibleTools]);

  const handleCategoryChange = async (tool, nextCategory) => {
    if ((tool.category || "") === nextCategory) return;
    await updateTool({ ...tool, category: nextCategory });
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Tools</h2>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto auto" }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Tool name..."
            style={{ border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14, background: "#fff", minWidth: 210 }}
          >
            <option value="">No category</option>
            {TOOL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Btn onClick={handleAdd}>Add Tool</Btn>
        </div>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Btn
            small
            color={showUncategorizedOnly ? "#232323" : "#6b7280"}
            onClick={() => setShowUncategorizedOnly((v) => !v)}
          >
            {showUncategorizedOnly ? "Show All Tools" : `Show Uncategorized (${uncategorizedCount})`}
          </Btn>
        </div>
      </Card>
      {tools.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No tools yet. Add one above.</p></Card>
      ) : (
        groupedTools.map(([groupName, items]) => (
          <div key={groupName} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700, color: "#7f8c8d", marginBottom: 6 }}>
              {groupName} ({items.length})
            </div>
            {items.map(tool => (
              <Card key={tool.id} style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 600, flex: 1 }}>{tool.name}</span>
                <select
                  value={tool.category || ""}
                  onChange={(e) => handleCategoryChange(tool, e.target.value)}
                  style={{ border: "1px solid #bdc3c7", borderRadius: 6, padding: "7px 8px", fontSize: 13, background: "#fff", minWidth: 180 }}
                >
                  <option value="">Uncategorized</option>
                  {TOOL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Btn small danger onClick={() => setConfirm({ message: `Delete "${tool.name}"?`, onConfirm: () => deleteTool(tool.id) })}>Delete</Btn>
              </Card>
            ))}
          </div>
        ))
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
