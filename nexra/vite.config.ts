import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.VITEST ? [] : [
      electron([
        { entry: 'electron/main.ts', vite: { build: { rollupOptions: { external: ['node-pty', 'better-sqlite3'] } } } },
        { entry: 'electron/preload.ts', onstart(o) { o.reload() } },
      ]),
      renderer(),
    ]),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
  },
})
