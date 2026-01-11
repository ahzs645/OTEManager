import { defineConfig } from "@tanstack/start/config";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    preset: "node-server",
  },
  vite: {
    plugins: [viteTsConfigPaths()],
    optimizeDeps: {
      exclude: ["mammoth"],
    },
    ssr: {
      noExternal: ["mammoth"],
    },
    define: {
      // Provide Buffer polyfill for client-side
      "global.Buffer": "globalThis.Buffer",
    },
    resolve: {
      alias: {
        buffer: "buffer/",
      },
    },
  },
});
