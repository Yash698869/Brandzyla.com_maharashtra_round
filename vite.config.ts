import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.HEIRLOOM_UI_PORT ?? 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.HEIRLOOM_RELAY_PORT ?? 3001}` } },
  build: { chunkSizeWarningLimit: 650, rollupOptions: { input: ['index.html', 'deploy.html'] } },
});
