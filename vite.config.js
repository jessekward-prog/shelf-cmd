import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.VITE_PROXY || 'http://localhost:3016',
      // Regex so the share-link prefix doesn't swallow /src during dev
      '^/s/': process.env.VITE_PROXY || 'http://localhost:3016'
    }
  }
})
