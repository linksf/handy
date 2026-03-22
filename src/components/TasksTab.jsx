import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import TaskEditor from "./TaskEditor";
import { uid } from "../utils";

export default function TasksTab({ job, saveJob, ctx }) {
  const { taskDefs, getTool } = ctx;
  const [selectedTaskDefId, setSelectedTaskDefId] = useState("");
  const [expanded, setExpanded] = useState(null);

  const addTask = () => {
    const taskDef = taskDefs.find(t => t.id === selectedTaskDefId);
    if (!taskDef) return;
    saveJob({
      tasks: [...(job.tasks || []), {
        id: uid(),
        taskDefId: taskDef.id,
        name: taskDef.name,
        toolIds: taskDef.toolIds || [],
        materials: [],
      }],
    });
    setSelectedTaskDefId("");
  };

  const removeTask = (tid) => saveJob({ tasks: job.tasks.filter(t => t.id !== tid) });
  const updateTask = (task) => saveJob({ tasks: job.tasks.map(t => t.id === task.id ? task : t) });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <select
          value={selectedTaskDefId}
          onChange={e => setSelectedTaskDefId(e.target.value)}
          style={{ flex: 1, border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14, background: "#fff" }}
        >
          <option value="">— Select a task —</option>
          {taskDefs.sort((a, b) => a.name.localeCompare(b.name)).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <Btn onClick={addTask} color={selectedTaskDefId ? "#2c3e50" : "#a0aec0"}>Add Task</Btn>
      </div>
      {taskDefs.length === 0 && (
        <Card style={{ marginBottom: 10 }}>
          <p style={{ color: "#a0aec0", textAlign: "center", margin: 0 }}>
            No tasks in library. Add tasks under the <strong>Tasks</strong> tab first.
          </p>
        </Card>
      )}
      {(job.tasks || []).length === 0 && taskDefs.length > 0 && (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No tasks added to this job yet.</p></Card>
      )}
      {(job.tasks || []).map(task => (
        <Card key={task.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, cursor: "pointer" }} onClick={() => setExpanded(expanded === task.id ? null : task.id)}>
              {task.name} {expanded === task.id ? "▲" : "▼"}
              <span style={{ fontWeight: 400, fontSize: 12, color: "#7f8c8d", marginLeft: 8 }}>
                {(task.toolIds || []).length} tool{(task.toolIds || []).length !== 1 ? "s" : ""}
              </span>
            </div>
            <Btn small danger onClick={() => removeTask(task.id)}>Remove</Btn>
          </div>
          {expanded === task.id && (
            <TaskEditor task={task} updateTask={updateTask} getTool={getTool} />
          )}
        </Card>
      ))}
    </div>
  );
}
