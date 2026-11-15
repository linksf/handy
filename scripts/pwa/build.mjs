import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const shellFiles = [
  "index.html", "manifest.webmanifest", "privacy.html", "terms.html",
  "icons/android-icon-192x192.png", "icons/apple-icon-180x180.png",
  "icons/app-icon-512.svg", "icons/app-icon-maskable.svg", "icons/app-icon-512.png",
];

export function handyPwaBuild() {
  let dir;
  return {
    name: "handy-pwa",
    apply: "build",
    async closeBundle() {
      const files = [...shellFiles, ...(await readdir(resolve(dir, "assets"))).map(name => `assets/${name}`)].sort();
      const hash = createHash("sha256");
      for (const file of files) hash.update(await readFile(resolve(dir, file)));
      const worker = await readFile(resolve(dir, "sw.js"), "utf8");
      hash.update(worker);
      await writeFile(resolve(dir, "sw.js"),
        worker.replace("/* BUILD_CONFIG */", `const BUILD = ${JSON.stringify({ version: hash.digest("hex").slice(0, 16), assets: files.map(file => "/" + file) })};`));
    },
    configResolved(config) { dir = resolve(config.root, config.build.outDir); },
  };
}
