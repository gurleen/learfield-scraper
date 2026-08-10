import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const uiReact = resolve(__dirname, "../ui/node_modules/react");
const uiReactDom = resolve(__dirname, "../ui/node_modules/react-dom");
const uiCoreSrc = resolve(__dirname, "../ui/packages/core/src/index.ts");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gurleen-ui/core": uiCoreSrc,
      react: uiReact,
      "react-dom": uiReactDom,
      "react/jsx-runtime": resolve(uiReact, "jsx-runtime.js"),
      "react/jsx-dev-runtime": resolve(uiReact, "jsx-dev-runtime.js"),
      "react-dom/client": resolve(uiReactDom, "client.js"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outdir: "dist",
    emptyOutDir: true,
  },
});
