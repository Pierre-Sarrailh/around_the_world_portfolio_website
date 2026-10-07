import { defineConfig } from 'vite';

export default defineConfig({
  // Set to '/<repo-name>/' if you deploy to GitHub Pages under a subpath.
  base: '/',
  server: {
    open: true,
  },
  build: {
    // .glb/.ktx2 are copied from public/ untouched; keep inlining off so
    // the browser can stream and cache them.
    assetsInlineLimit: 0,
  },
});
