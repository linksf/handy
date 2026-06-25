#!/usr/bin/env node
/**
 * Seeds handyman task templates into Firestore `tasks` with tool assignments.
 *
 * Auth options (pick one):
 *   A) Service account JSON:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
 *   B) gcloud user credentials (no JSON key needed):
 *        gcloud auth application-default login --project handyjob-d3464
 *
 * Or skip this script entirely: sign in at /admin → Tasks → "Import handyman tasks".
 *
 * Usage:
 *   npm run seed-handyman-tasks
 *   npm run seed-handyman-tasks -- --update
 *   npm run seed-handyman-tasks -- --dry-run
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import admin from "firebase-admin";
import { RECOMMENDED_TOOLS } from "../src/toolCatalog.js";
import { HANDYMAN_TASK_TEMPLATES } from "../src/handymanTaskTemplates.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const updateExisting = args.has("--update");

function initAdmin() {
  if (admin.apps.length) return;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : null;

  if (credPath && existsSync(credPath)) {
    const sa = JSON.parse(readFileSync(credPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    console.log("Using service account:", credPath);
    return;
  }

  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log("Using Application Default Credentials (gcloud auth application-default login)");
  } catch {
    console.error(
      "No credentials found.\n\n" +
        "Option 1 — In the app (easiest):\n" +
        "  Sign in at /admin → Tasks → Import handyman tasks\n\n" +
        "Option 2 — gcloud (no JSON key):\n" +
        "  gcloud auth application-default login --project handyjob-d3464\n" +
        "  npm run seed-handyman-tasks\n\n" +
        "Option 3 — Service account JSON:\n" +
        "  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json\n"
    );
    process.exit(1);
  }
}

initAdmin();
const db = admin.firestore();

function normName(s) {
  return String(s || "").trim().toLowerCase();
}

async function loadTools() {
  const snap = await db.collection("tools").get();
  const byName = new Map();
  for (const doc of snap.docs) {
    const name = doc.data().name;
    if (name) byName.set(normName(name), { id: doc.id, name, ...doc.data() });
  }
  return byName;
}

async function ensureTools(byName) {
  let added = 0;
  for (const t of RECOMMENDED_TOOLS) {
    if (byName.has(normName(t.name))) continue;
    if (dryRun) {
      console.log(`[dry-run] would add tool: ${t.name}`);
      byName.set(normName(t.name), { id: `(new:${t.name})`, name: t.name });
      added++;
      continue;
    }
    const ref = await db.collection("tools").add({
      name: t.name,
      category: t.category || "",
    });
    byName.set(normName(t.name), { id: ref.id, name: t.name, category: t.category || "" });
    console.log(`Added tool: ${t.name}`);
    added++;
  }
  return added;
}

function toolIdsForTemplate(template, byName) {
  const ids = [];
  const missing = [];
  for (const toolName of template.tools) {
    const row = byName.get(normName(toolName));
    if (row?.id && !String(row.id).startsWith("(new:")) {
      if (!ids.includes(row.id)) ids.push(row.id);
    } else if (dryRun && row?.id) {
      if (!ids.includes(row.id)) ids.push(row.id);
    } else {
      missing.push(toolName);
    }
  }
  return { toolIds: ids, missing };
}

async function loadExistingTasks() {
  const snap = await db.collection("tasks").get();
  const byName = new Map();
  for (const doc of snap.docs) {
    const name = doc.data().name;
    if (name) byName.set(normName(name), { id: doc.id, ...doc.data() });
  }
  return byName;
}

async function main() {
  console.log(`Seeding ${HANDYMAN_TASK_TEMPLATES.length} handyman task templates…`);
  if (dryRun) console.log("(dry run — no writes)");

  const toolsByName = await loadTools();
  const toolsAdded = await ensureTools(toolsByName);
  const tasksByName = await loadExistingTasks();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const warnings = [];

  for (const template of HANDYMAN_TASK_TEMPLATES) {
    const key = normName(template.name);
    const { toolIds, missing } = toolIdsForTemplate(template, toolsByName);
    if (missing.length) {
      warnings.push(`${template.name}: unknown tools — ${missing.join(", ")}`);
    }

    const existing = tasksByName.get(key);
    if (existing) {
      if (!updateExisting) {
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] would update: ${template.name} (${toolIds.length} tools)`);
        updated++;
        continue;
      }
      await db.collection("tasks").doc(existing.id).update({ name: template.name, toolIds });
      await db.collection("taskCatalog").doc(existing.id).set({ name: template.name });
      console.log(`Updated: ${template.name} (${toolIds.length} tools)`);
      updated++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would create: ${template.name} (${toolIds.length} tools)`);
      created++;
      continue;
    }

    const ref = await db.collection("tasks").add({ name: template.name, toolIds });
    await db.collection("taskCatalog").doc(ref.id).set({ name: template.name });
    console.log(`Created: ${template.name} (${toolIds.length} tools) → ${ref.id}`);
    created++;
  }

  console.log("\nDone.");
  console.log(`  Tools added: ${toolsAdded}`);
  console.log(`  Tasks created: ${created}`);
  console.log(`  Tasks updated: ${updated}`);
  console.log(`  Tasks skipped (already exist): ${skipped}`);
  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (skipped > 0 && !updateExisting) {
    console.log("\nRe-run with --update to refresh tool assignments on existing tasks.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
