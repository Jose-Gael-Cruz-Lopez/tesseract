import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  // The admin SPA is served under /admin in the fused deploy (Mnemosphere owns
  // /). base rewrites every emitted asset URL to /admin/…; hash routing means
  // no server-side route config is needed. emptyOutDir clears only dist/admin.
  base: "/admin/",
  build: {
    outDir: path.join(__dirname, "dist", "admin"),
    emptyOutDir: true,
  },
  resolve: {
    alias: { "@shared": path.join(__dirname, "..", "shared") },
  },
});
