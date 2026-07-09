// Merged build for the fused single-Worker deploy. Produces one asset tree in
// canopy/web/dist that the Worker's ASSETS binding serves:
//   web/dist/            → the Mnemosphere UI (served at /)
//   web/dist/admin/      → canopy's own admin SPA (served at /admin, base:/admin/)
// Non-file paths (/docs, /feed, /auth/*, /mcp, /webhook) fall through to the Worker.
import { execSync } from 'node:child_process';
import { rmSync, cpSync } from 'node:fs';
import path from 'node:path';

const canopy = path.resolve(import.meta.dirname, '..'); // canopy/
const repo = path.resolve(canopy, '..');                // repo root (Mnemosphere)
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

// 1. Build the Mnemosphere UI → repo/dist (embeds only the Supabase publishable key).
run('npm run build', repo);
// 2. Clean the Worker asset tree so no stale files linger.
rmSync(path.join(canopy, 'web/dist'), { recursive: true, force: true });
// 3. Build canopy's admin SPA (base:/admin/) → web/dist/admin.
run('npx vite build --config web/vite.config.ts', canopy);
// 4. Lay the Mnemosphere build over the root, leaving web/dist/admin intact.
cpSync(path.join(repo, 'dist'), path.join(canopy, 'web/dist'), { recursive: true });

console.log('\nbuild:app complete → web/dist (Mnemosphere at /) + web/dist/admin (canopy at /admin)');
