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
  }
})
