import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  plugins: [
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart({ srcDirectory: 'app' }),
    viteReact(),
    nitro(),
  ],
  optimizeDeps: {
    exclude: ['mammoth'],
  },
  ssr: {
    external: ['mammoth'],
  },
  define: {
    'global.Buffer': 'globalThis.Buffer',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
})
