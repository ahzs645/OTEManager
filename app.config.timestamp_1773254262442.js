// app.config.ts
import { defineConfig } from "@tanstack/start/config";
import viteTsConfigPaths from "vite-tsconfig-paths";
var app_config_default = defineConfig({
  server: {
    preset: "node-server"
  },
  vite: {
    plugins: [viteTsConfigPaths()],
    optimizeDeps: {
      exclude: ["mammoth"]
    },
    ssr: {
      external: ["mammoth"]
    },
    define: {
      // Provide Buffer polyfill for client-side
      "global.Buffer": "globalThis.Buffer"
    },
    resolve: {
      alias: {
        buffer: "buffer/"
      }
    }
  }
});
export {
  app_config_default as default
};
