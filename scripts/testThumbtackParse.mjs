#!/usr/bin/env node
/**
 * Smoke-test Thumbtack lead parsing against exampleThumbtackWebhook.json
 *
 *   cd functions && npm run build && cd ..
 *   node scripts/testThumbtackParse.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const examplePath = resolve(root, "exampleThumbtackWebhook.json");

const mod = await import(resolve(root, "functions/lib/thumbtackWebhook.js"));
const { parseThumbtackLeadPayload } = mod;

const raw = JSON.parse(readFileSync(examplePath, "utf8"));
const parsed = parseThumbtackLeadPayload(raw);

const checks = [
  ["name", parsed.name, "Jeni M"],
  ["phone", parsed.phone, "2344234019"],
  ["thumbtackCustomerId", parsed.thumbtackCustomerId, "566510215274676232"],
  ["jobTitle", parsed.jobTitle, "Handyman"],
  ["externalId", parsed.externalId, "581798716676227081"],
  ["address includes city", parsed.address.includes("San Francisco"), true],
  ["hourlyRate from estimate", parsed.hourlyRate, "75.00"],
  ["hours from estimated hours detail", parsed.hours, "2"],
  ["no lead fee when leadPrice empty", parsed.expenses.length, 0],
  ["client notes omit Thumbtack status", parsed.clientJobNotes.includes("Thumbtack status"), false],
  ["client notes omit estimate line", parsed.clientJobNotes.includes("$75/hour"), false],
  ["admin notes include proposed times", parsed.adminJobNotes.includes("proposed times"), true],
  ["client notes include description", parsed.clientJobNotes.includes("move these"), true],
];

let failed = 0;
for (const [label, actual, expected] of checks) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}

console.log("\nClient job notes:");
console.log(parsed.clientJobNotes);
console.log("\nAdmin job notes:");
console.log(parsed.adminJobNotes);
console.log("\nRevenue:", {
  price: parsed.price,
  hourlyRate: parsed.hourlyRate,
  hours: parsed.hours,
});
console.log("Expenses:", parsed.expenses);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nAll checks passed.");
