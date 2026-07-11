export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
  GITHUB_WEBHOOK_SECRET?: string; // HMAC key for the /webhook/github third auth class; absent → the surface 401s
  GITHUB_REPO?: string;   // "owner/repo" for live roadmap progress; absent → milestones without progress
  AUTH_ORG?: string;      // GitHub org whose active members may log in. Empty/absent ⇒ allow-list mode (ADMIN_LOGINS gates login).
  CORS_ORIGINS?: string;  // comma-separated origins allowed cross-origin (GET only) — e.g. the Mnemosphere dev sphere
  DEV_LOGIN?: string;     // LOCAL DEV ONLY (set in .dev.vars): bypass OAuth, act as this seeded user. Never set in prod.
  GEMINI_API_KEY?: string; // Google Gemini key for capture-time PR/issue summaries (REST generateContent); absent → excerpt fallback.
  GITHUB_SERVICE_TOKEN?: string; // app-level token for the scheduled progress-cache recompute backstop; absent → scheduled() no-ops
  ADMIN_LOGINS?: string;  // comma-separated GitHub logins allowed to run admin actions (e.g. the server-side backfill)
  // GitHub App (Phase 3, connect-your-repos). Absent → App features (install, per-repo
  // tokens) are inert. GITHUB_APP_PRIVATE_KEY is a PKCS#8 PEM (convert the downloaded
  // PKCS#1 key: `openssl pkcs8 -topk8 -nocrypt -in app.pem`).
  GITHUB_APP_ID?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}
