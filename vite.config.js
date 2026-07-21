import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  appType: "spa",
  resolve: {
    // Avoid two React copies (hooks throw: "Cannot read properties of null (reading 'useState')").
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/functions/**",
    ],
  },
});
