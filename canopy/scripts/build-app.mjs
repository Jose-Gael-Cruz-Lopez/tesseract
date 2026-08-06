// Merged build for the fused single-Worker deploy. Produces one asset tree in
// canopy/web/dist that the Worker's ASSETS binding serves:
//   web/dist/            → the Mnemosphere UI (served at /)
//   web/dist/admin/      → canopy's own admin SPA (served at /admin, base:/admin/)
// Non-file paths (/docs, /feed, /auth/*, /mcp, /webhook) fall through to the Worker.
import { execSync } from 'node:child_process';
import { rmSync, cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const canopy = path.resolve(import.meta.dirname, '..'); // canopy/
const repo = path.resolve(canopy, '..');                // repo root (Mnemosphere)
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

// GUARD: the Mnemosphere build compiles Supabase (Google sign-in + workspace
// cloud sync) IN or OUT at build time — src/data/supabase.js constant-folds on
// import.meta.env.VITE_SUPABASE_URL, and a build without it tree-shakes
// supabase-js away entirely. A fused deploy from a machine missing .env.local
// would silently ship production WITHOUT Google sign-in (found by the 2026-08
// audit: the last local build had zero "supabase" strings). Workers Builds
// injects the vars dashboard-side; a workstation needs .env.local. Refuse to
// build blind — CANOPY_ALLOW_NO_SUPABASE=1 overrides for deliberately
// Supabase-less builds (e.g. a fork that only uses the demo auth flow).
function supabaseConfigured() {
  if (process.env.VITE_SUPABASE_URL) return true;
  for (const name of ['.env.local', '.env', '.env.production']) {
    const p = path.join(repo, name);
    if (existsSync(p) && /^\s*VITE_SUPABASE_URL\s*=\s*\S/m.test(readFileSync(p, 'utf8'))) return true;
  }
  return false;
}
if (!supabaseConfigured() && process.env.CANOPY_ALLOW_NO_SUPABASE !== '1') {
  console.error(
    '\nbuild:app REFUSED: VITE_SUPABASE_URL is not set (env or <repo>/.env.local).\n' +
    'A fused build without it silently ships production with Google sign-in and\n' +
    'workspace cloud sync compiled OUT. See canopy/docs/runbooks/deploy-pipeline.md.\n' +
    'To build without Supabase on purpose: CANOPY_ALLOW_NO_SUPABASE=1 npm run build:app\n'
  );
  process.exit(1);
}

// 1. Build the Mnemosphere UI → repo/dist (embeds only the Supabase publishable key).
run('npm run build', repo);
// 2. Clean the Worker asset tree so no stale files linger.
rmSync(path.join(canopy, 'web/dist'), { recursive: true, force: true });
// 3. Build canopy's admin SPA (base:/admin/) → web/dist/admin.
run('npx vite build --config web/vite.config.ts', canopy);
// 4. Lay the Mnemosphere build over the root, leaving web/dist/admin intact.
cpSync(path.join(repo, 'dist'), path.join(canopy, 'web/dist'), { recursive: true });

console.log('\nbuild:app complete → web/dist (Mnemosphere at /) + web/dist/admin (canopy at /admin)');
