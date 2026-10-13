import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const certPath = path.join(__dirname, 'certs')
const hasCerts = fs.existsSync(path.join(certPath, 'localhost-key.pem')) && fs.existsSync(path.join(certPath, 'localhost.pem'))

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: hasCerts ? {
      key: fs.readFileSync(path.join(certPath, 'localhost-key.pem')),
      cert: fs.readFileSync(path.join(certPath, 'localhost.pem')),
    } : false,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          // ZXing is statically imported by the scanner engine (offline-first:
          // no lazy chunk may gate a mid-scan fallback). It lives in its own
          // chunk so the entry stays lean; Vite's default modulePreload
          // injects the preload link for it automatically at build time.
          zxing: ['@zxing/library'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
})
