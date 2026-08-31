import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Name ONLY the dependencies every screen genuinely needs.
         *
         * The obvious-looking version of this function ends with a catch-all --
         * `return 'vendor'` for anything else in node_modules -- and it makes
         * things worse, not better. A catch-all forces every remaining package
         * into one chunk, and a chunk is loaded whole: the moment any eagerly
         * reachable module touches any part of it, all 1.4 MB arrives, PDF
         * writers and chart libraries included, on a page that renders neither.
         * Measured: it put 2.6 MB on the critical path where the page needed
         * about 0.5 MB of it.
         *
         * Returning undefined hands the decision back to Rollup, which already
         * does this well -- it keeps a package in the page chunk that imports it
         * and hoists one into a shared chunk only when several pages actually
         * share it. Route-level lazy loading (see pages.config.js) then means a
         * page's dependencies arrive with the page and not before.
         *
         * React and the router are the exception worth naming: they are on
         * every screen without exception, so pinning them to one stable chunk
         * means the browser caches them once across every navigation and every
         * deploy that does not change React itself.
         */
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
