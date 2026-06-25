import { addDoc, collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { HANDYMAN_TASK_TEMPLATES } from "../handymanTaskTemplates.js";
import { RECOMMENDED_TOOLS } from "../toolCatalog.js";
import { syncTaskCatalogEntry } from "./taskCatalog.js";

function normName(s) {
  return String(s || "").trim().toLowerCase();
}

function toolIdsForTemplate(template, toolsByName) {
  const ids = [];
  const missing = [];
  for (const toolName of template.tools) {
    const row = toolsByName.get(normName(toolName));
    if (row?.id) {
      if (!ids.includes(row.id)) ids.push(row.id);
    } else {
      missing.push(toolName);
    }
  }
  return { toolIds: ids, missing };
}

/**
 * Seed handyman task templates using the signed-in owner's Firestore access (no service account).
 */
export async function seedHandymanTaskTemplates(db, { updateExisting = false } = {}) {
  const toolsSnap = await getDocs(collection(db, "tools"));
  const toolsByName = new Map();
  for (const d of toolsSnap.docs) {
    const name = d.data().name;
    if (name) toolsByName.set(normName(name), { id: d.id, name });
  }

  let toolsAdded = 0;
  for (const t of RECOMMENDED_TOOLS) {
    if (toolsByName.has(normName(t.name))) continue;
    const ref = await addDoc(collection(db, "tools"), {
      name: t.name,
      category: t.category || "",
    });
    toolsByName.set(normName(t.name), { id: ref.id, name: t.name });
    toolsAdded++;
  }

  const tasksSnap = await getDocs(collection(db, "tasks"));
  const tasksByName = new Map();
  for (const d of tasksSnap.docs) {
    const name = d.data().name;
    if (name) tasksByName.set(normName(name), { id: d.id, ...d.data() });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const warnings = [];

  for (const template of HANDYMAN_TASK_TEMPLATES) {
    const key = normName(template.name);
    const { toolIds, missing } = toolIdsForTemplate(template, toolsByName);
    if (missing.length) {
      warnings.push(`${template.name}: missing tools — ${missing.join(", ")}`);
    }

    const existing = tasksByName.get(key);
    if (existing) {
      if (!updateExisting) {
        skipped++;
        continue;
      }
      await updateDoc(doc(db, "tasks", existing.id), { name: template.name, toolIds });
      await syncTaskCatalogEntry(db, existing.id, template.name);
      updated++;
      continue;
    }

    const ref = await addDoc(collection(db, "tasks"), { name: template.name, toolIds });
    await syncTaskCatalogEntry(db, ref.id, template.name);
    created++;
  }

  return { created, updated, skipped, toolsAdded, warnings, total: HANDYMAN_TASK_TEMPLATES.length };
}
