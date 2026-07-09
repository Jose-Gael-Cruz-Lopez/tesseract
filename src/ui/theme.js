// Theme application + system-preference listener.
//
// Reads/writes localStorage key `ms:prefs` directly (not via src/data/store.js)
// so theming works before the store is available (auth screens run before a
// workspace/session exists). Every access is wrapped in try/catch so a
// private-mode / storage-disabled browser degrades to in-memory only.

const PREFS_KEY = 'ms:prefs';
// Default to light so a fresh workspace matches the (light) reference design;
// users can switch to Dark or Use-system in Settings → Appearance.
const DEFAULT_MODE = 'light';

let mediaQuery = null;
let mediaListener = null;

function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / storage disabled: theme still applies for this session
  }
}

function systemPrefersDark() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function resolve(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  return systemPrefersDark() ? 'dark' : 'light';
}

// Set the resolved theme on <html> and notify listeners (e.g. the globe, which
// isn't styled by CSS tokens and repaints itself on theme change).
function setResolved(resolved) {
  document.documentElement.dataset.theme = resolved;
  try {
    document.dispatchEvent(new CustomEvent('mnemosphere:themechange', { detail: { theme: resolved } }));
  } catch {
    // CustomEvent unavailable (bare node) — attribute is still set
  }
}

function apply(mode) {
  setResolved(resolve(mode));
}

function unwatchSystem() {
  if (mediaQuery && mediaListener) {
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', mediaListener);
    } else if (typeof mediaQuery.removeListener === 'function') {
      mediaQuery.removeListener(mediaListener);
    }
  }
  mediaQuery = null;
  mediaListener = null;
}

function watchSystem(mode) {
  unwatchSystem();
  if (mode !== 'system') return;
  try {
    mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    mediaListener = (event) => {
      setResolved(event.matches ? 'dark' : 'light');
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', mediaListener);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(mediaListener);
    }
  } catch {
    // matchMedia unavailable: static resolve() already applied light/dark
  }
}

// apply saved pref ('system' default -> light); listen to system changes
export function initTheme() {
  const mode = getTheme();
  apply(mode);
  watchSystem(mode);
}

// 'light'|'dark'|'system' -> sets <html data-theme>, persists pref
export function setTheme(mode) {
  const prefs = readPrefs();
  prefs.theme = mode;
  writePrefs(prefs);
  apply(mode);
  watchSystem(mode);
}

// saved mode
export function getTheme() {
  const prefs = readPrefs();
  return prefs.theme || DEFAULT_MODE;
}
