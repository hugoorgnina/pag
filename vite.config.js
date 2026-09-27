import { defineConfig } from 'vite';

// Relative base so the production build works from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  // three.js alone is ~600 kB minified; that's expected for a single-page game.
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
