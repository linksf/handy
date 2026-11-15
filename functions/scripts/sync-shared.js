#!/usr/bin/env node
/**
 * Copy repo-root shared/ into functions/shared/ so Firebase Cloud Build can
 * resolve `@handy/shared` via `file:./shared` (paths outside functions/ are
 * not uploaded).
 */
const fs = require("fs");
const path = require("path");

const src = path.resolve(__dirname, "../../shared");
const dest = path.resolve(__dirname, "../shared");

if (!fs.existsSync(src)) {
  console.error(`sync-shared: missing source directory ${src}`);
  process.exit(1);
}

fs.rmSync(dest, {recursive: true, force: true});
fs.mkdirSync(dest, {recursive: true});
for (const name of fs.readdirSync(src)) {
  fs.cpSync(path.join(src, name), path.join(dest, name), {recursive: true});
}
console.log(`sync-shared: copied ${src} -> ${dest}`);
