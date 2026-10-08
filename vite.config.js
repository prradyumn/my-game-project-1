import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
});
