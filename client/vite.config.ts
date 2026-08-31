import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Point at the sources so shared rules hot-reload with the UI.
      '@bbc/shared': here('../shared/src/index.ts'),
      '@': here('./src'),
    },
  },
  server: {
    port: 5173,
    // The client always talks to /ws on its own origin; in dev Vite forwards
    // that to the game server, so there is one code path for both.
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          motion: ['motion/react'],
        },
      },
    },
  },
});
