import { deleteDoc, doc, getDocs, collection, setDoc } from "firebase/firestore";
import { uid } from "../utils";

/** Client-visible task names only (no tools). Doc id matches `tasks/{id}`. */
export async function syncTaskCatalogEntry(db, taskId, name) {
  const trimmed = String(name || "").trim();
  if (!taskId || !trimmed) return;
  await setDoc(doc(db, "taskCatalog", taskId), { name: trimmed });
}

export async function deleteTaskCatalogEntry(db, taskId) {
  if (!taskId) return;
  await deleteDoc(doc(db, "taskCatalog", taskId));
}

/** Build a job line item from a task template (owner data may include toolIds). */
export function jobTaskFromTemplate(taskDef, uid) {
  return {
    id: uid(),
    taskDefId: taskDef.id,
    name: taskDef.name,
    toolIds: taskDef.toolIds || [],
    materials: [],
  };
}

/** Build job tasks from booking request selections (resolve tools from owner templates). */
export function jobTasksFromBookingRequest(request, taskDefs) {
  const rows = request?.requestedTasks || [];
  return rows.map((row) => {
    const def = taskDefs.find((t) => t.id === row.taskCatalogId);
    return {
      id: uid(),
      taskDefId: row.taskCatalogId,
      name: row.name || def?.name || "Task",
      toolIds: def?.toolIds || [],
      materials: [],
    };
  });
}

/** Same as above but loads current task templates from Firestore (fresh toolIds). */
export async function jobTasksFromBookingRequestAsync(db, request) {
  const rows = request?.requestedTasks || [];
  if (!rows.length) return [];
  const snap = await getDocs(collection(db, "tasks"));
  const taskDefs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return jobTasksFromBookingRequest(request, taskDefs);
}
