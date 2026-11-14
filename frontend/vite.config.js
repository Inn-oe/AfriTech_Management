import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, API calls are proxied to the Flask server (python main.py).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/_health': 'http://127.0.0.1:5000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
