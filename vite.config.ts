import { defineConfig } from 'vite';

export default defineConfig({
  // Set to '/<repo-name>/' if you deploy to GitHub Pages under a subpath.
  base: '/',
  server: {
    open: true,
  },
});
