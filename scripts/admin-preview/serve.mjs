import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = "/tmp/handy-admin-synthetic-preview";
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};
const host = process.env.HANDY_PREVIEW_HOST || "127.0.0.1";
const port = Number(process.env.HANDY_PREVIEW_PORT || 5175);

createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/") {
    res.writeHead(302, { Location: "/admin/dashboard" }).end();
    return;
  }
  const page = /^\/(admin|book|profile)(\/|$)/.test(pathname);
  const file = resolve(root, page ? "index.html" : pathname.slice(1));
  if (!file.startsWith(root + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'",
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => console.log(`Synthetic admin preview at http://${host}:${port}/admin/dashboard`));
