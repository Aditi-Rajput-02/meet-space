import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  // Explicitly set root to prevent Vite from traversing up the directory tree
  // This fixes "Cannot read directory" access denied errors on Windows servers
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
})
