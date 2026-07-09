// The GitHub repo this Canopy instance tracks. Used to build issue / PR / commit /
// milestone links across the UI so the app feels connected to the real repo.
// Set VITE_REPO_URL at build time (see canopy/SETUP.md); falls back to GitHub root.
export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com";
