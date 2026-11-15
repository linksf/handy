import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../../vite.config.js";

const here = name => fileURLToPath(new URL(name, import.meta.url));
const replacements = {
  "firebase/firestore": here("./firestore.js"),
  "firebase/functions": here("./services.js"),
};

export default defineConfig(() => {
  return mergeConfig(baseConfig, {
    define: { "import.meta.env.HANDY_SYNTHETIC_PREVIEW": "true" },
    // Build only the synthetic app into a separate directory.
    build: { outDir: "/tmp/handy-admin-synthetic-preview", emptyOutDir: true },
    plugins: [{
      name: "isolated-admin-preview",
      enforce: "pre",
      resolveId(id, importer) {
        if (replacements[id]) return replacements[id];
        if (/^(?:\.\.\/|\.\/)+firebase$/.test(id)) return here("./services.js");
        if (id === "../../hooks/useClientAuth" && importer?.endsWith("/ClientApp.jsx")) return here("./services.js");
        if (id === "./hooks/useAuth" && importer?.endsWith("/src/App.jsx")) return here("./services.js");
      },
      transformIndexHtml() {
        return [{
          tag: "div", injectTo: "body-prepend", children: "Handy preview · Synthetic data",
          attrs: { style: "background:#dbeee4;color:#1b4430;padding:8px 14px;font:600 13px system-ui" },
        }];
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/") { res.writeHead(302, { Location: "/admin/dashboard" }); res.end(); }
          else next();
        });
      },
    }],
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  });
});
