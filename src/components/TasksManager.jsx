import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import ConfirmModal from "./ui/ConfirmModal";

export default function TasksManager({ ctx }) {
  const { taskDefs, tools, addTaskDef, updateTaskDef, deleteTaskDef } = ctx;
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    addTaskDef(name.trim());
    setName("");
  };

  const toggleTool = (taskDef, toolId) => {
    const toolIds = taskDef.toolIds || [];
    const updated = toolIds.includes(toolId)
      ? toolIds.filter(id => id !== toolId)
      : [...toolIds, toolId];
    updateTaskDef({ ...taskDef, toolIds: updated });
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Tasks</h2>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Task name..."
            style={{ flex: 1, border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
          />
          <Btn onClick={handleAdd}>Add Task</Btn>
        </div>
      </Card>
      {taskDefs.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No tasks yet. Add one above.</p></Card>
      ) : (
        taskDefs.sort((a, b) => a.name.localeCompare(b.name)).map(taskDef => (
          <Card key={taskDef.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div
                style={{ fontWeight: 600, cursor: "pointer" }}
                onClick={() => setExpanded(expanded === taskDef.id ? null : taskDef.id)}
              >
                {taskDef.name} {expanded === taskDef.id ? "▲" : "▼"}
                <span style={{ fontWeight: 400, fontSize: 12, color: "#7f8c8d", marginLeft: 8 }}>
                  {(taskDef.toolIds || []).length} tool{(taskDef.toolIds || []).length !== 1 ? "s" : ""}
                </span>
              </div>
              <Btn small danger onClick={() => setConfirm({ message: `Delete "${taskDef.name}"?`, onConfirm: () => deleteTaskDef(taskDef.id) })}>Delete</Btn>
            </div>
            {expanded === taskDef.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid #ecf0f1", paddingTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#7f8c8d" }}>Assign Tools</div>
                {tools.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#a0aec0" }}>No tools in library yet. Add tools under the Tools tab first.</p>
                ) : (
                  tools.sort((a, b) => a.name.localeCompare(b.name)).map(tool => (
                    <label key={tool.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer", fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={(taskDef.toolIds || []).includes(tool.id)}
                        onChange={() => toggleTool(taskDef, tool.id)}
                        style={{ width: 15, height: 15 }}
                      />
                      {tool.name}
                    </label>
                  ))
                )}
              </div>
            )}
          </Card>
        ))
      )}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={() => {
            confirm.onConfirm();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
