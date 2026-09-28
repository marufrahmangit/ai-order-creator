import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths, so dist/ works wherever it is served from - the
  // subdomain root today, a subdirectory if that ever changes.
  base: './',

  server: {
    // 5173 is not a preference, it is a contract: the plugin's App Origin
    // setting holds ONE origin, and on staging it is http://localhost:5173.
    // Vite's default behaviour on a taken port is to silently move to 5174,
    // which would make every API call fail CORS with no obvious cause. Fail
    // to start instead.
    port: 5173,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Untracked build output (see .gitignore). What reaches the subdomain is
    // this directory, not the source tree.
    sourcemap: true,
  },
})
