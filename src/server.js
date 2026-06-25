import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT) || 3847;
const MAX_EVENTS = Number(process.env.MAX_EVENTS) || 100;

/** @type {Array<{ id: string; receivedAt: string; method: string; path: string; query: Record<string, string | string[]>; headers: Record<string, string | string[] | undefined>; rawBody: string; parsedJson: unknown }>} */
const events = [];

function pushEvent(entry) {
  events.unshift(entry);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function collectHeaders(req) {
  /** @type {Record<string, string | string[] | undefined>} */
  const h = { ...req.headers };
  return h;
}

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Thumbtack webhook inbox</title>
  <style>
    :root {
      color-scheme: dark light;
      --bg: #0f1115;
      --panel: #171a21;
      --border: #2a3140;
      --text: #e8eaed;
      --muted: #9aa0a6;
      --accent: #3b82f6;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f6f7f9;
        --panel: #fff;
        --border: #d8dee9;
        --text: #1a1d23;
        --muted: #5f6368;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    h1 { font-size: 1.125rem; margin: 0 0 0.25rem; font-weight: 600; }
    .sub { color: var(--muted); font-size: 0.875rem; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.8125rem; }
    main { padding: 1rem 1.25rem 2rem; max-width: 960px; margin: 0 auto; }
    .empty {
      color: var(--muted);
      padding: 2rem 0;
      text-align: center;
    }
    article {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 1rem;
      overflow: hidden;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.8125rem;
      color: var(--muted);
    }
    .meta strong { color: var(--text); font-weight: 500; }
    pre {
      margin: 0;
      padding: 1rem;
      overflow: auto;
      max-height: 420px;
      font-size: 0.75rem;
      line-height: 1.45;
      background: rgba(0,0,0,0.15);
    }
    @media (prefers-color-scheme: light) {
      pre { background: #f0f3f8; }
    }
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
    }
    .tabs button {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--muted);
      padding: 0.6rem 0.75rem;
      cursor: pointer;
      font: inherit;
      font-size: 0.8125rem;
    }
    .tabs button[aria-selected="true"] {
      color: var(--text);
      box-shadow: inset 0 -2px 0 var(--accent);
      font-weight: 600;
    }
    .panel { display: none; }
    .panel.active { display: block; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8125rem;
      color: var(--muted);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }
    .dot.err { background: #ef4444; }
  </style>
</head>
<body>
  <header>
    <h1>Thumbtack webhook inbox</h1>
    <p class="sub">POST URL for Thumbtack: <code id="url"></code></p>
    <p class="status"><span class="dot" id="dot"></span><span id="status">Connecting…</span></p>
  </header>
  <main id="main"></main>
  <script>
    const urlEl = document.getElementById("url");
    urlEl.textContent = location.origin + "/webhook";

    const main = document.getElementById("main");
    const status = document.getElementById("status");
    const dot = document.getElementById("dot");

    function esc(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function render(events) {
      if (!events.length) {
        main.innerHTML = '<p class="empty">No webhooks yet. When Thumbtack POSTs to <code>' + esc(urlEl.textContent) + '</code>, they will appear here.</p>';
        return;
      }
      main.innerHTML = events.map((ev) => {
        const jsonStr = ev.parsedJson != null
          ? JSON.stringify(ev.parsedJson, null, 2)
          : "(body was not valid JSON — see Raw)";
        const headersStr = JSON.stringify(ev.headers, null, 2);
        return (
          '<article data-id="' + esc(ev.id) + '">' +
            '<div class="meta">' +
              '<span><strong>Received</strong> ' + esc(ev.receivedAt) + '</span>' +
              '<span><strong>' + esc(ev.method) + '</strong> ' + esc(ev.path) + '</span>' +
            '</div>' +
            '<div class="tabs" role="tablist">' +
              '<button type="button" role="tab" aria-selected="true" data-tab="json">JSON</button>' +
              '<button type="button" role="tab" aria-selected="false" data-tab="raw">Raw body</button>' +
              '<button type="button" role="tab" aria-selected="false" data-tab="headers">Headers</button>' +
            '</div>' +
            '<div class="panel active" data-panel="json"><pre>' + esc(jsonStr) + '</pre></div>' +
            '<div class="panel" data-panel="raw"><pre>' + esc(ev.rawBody || "") + '</pre></div>' +
            '<div class="panel" data-panel="headers"><pre>' + esc(headersStr) + '</pre></div>' +
          '</article>'
        );
      }).join("");

      main.querySelectorAll("article").forEach((art) => {
        const tabs = art.querySelectorAll(".tabs button");
        const panels = art.querySelectorAll(".panel");
        tabs.forEach((btn) => {
          btn.addEventListener("click", () => {
            const name = btn.getAttribute("data-tab");
            tabs.forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
            panels.forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === name));
          });
        });
      });
    }

    async function poll() {
      try {
        const r = await fetch("/api/events", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        render(data.events || []);
        status.textContent = "Live · last update " + new Date().toLocaleTimeString();
        dot.classList.remove("err");
      } catch (e) {
        status.textContent = "Could not load events: " + (e && e.message ? e.message : e);
        dot.classList.add("err");
      }
    }

    poll();
    setInterval(poll, 2000);
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  let u;
  try {
    u = new URL(req.url || "/", `http://${host}`);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  const pathname = u.pathname;

  if (pathname === "/" && req.method === "GET") {
    text(res, 200, dashboardHtml(), "text/html; charset=utf-8");
    return;
  }

  if (pathname === "/api/events" && req.method === "GET") {
    json(res, 200, { events });
    return;
  }

  if (pathname === "/webhook" && req.method === "GET") {
    text(res, 200, "webhook endpoint ready (POST payloads here)");
    return;
  }

  if (pathname === "/webhook" && req.method === "POST") {
    try {
      const buf = await readBody(req);
      const rawBody = buf.toString("utf8");
      let parsedJson = null;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        /* keep raw only */
      }

      pushEvent({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        receivedAt: new Date().toISOString(),
        method: req.method,
        path: pathname,
        query: Object.fromEntries(u.searchParams.entries()),
        headers: collectHeaders(req),
        rawBody,
        parsedJson,
      });

      text(res, 200, "ok");
    } catch (e) {
      text(res, 413, "payload too large");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log("Thumbtack webhook viewer (no dependencies)");
  console.log(`  Dashboard: http://localhost:${PORT}/`);
  console.log(`  Webhook:   http://localhost:${PORT}/webhook`);
});
