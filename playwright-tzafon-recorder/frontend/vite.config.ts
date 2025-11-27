import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_BASE = process.env.VITE_API_BASE || 'http://127.0.0.1:8010';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_BASE,
        changeOrigin: true,
      },
      '/health': {
        target: API_BASE,
        changeOrigin: true,
      },
    },
  },
});
