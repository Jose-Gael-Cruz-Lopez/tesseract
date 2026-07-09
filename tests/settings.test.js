// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { openSettings } from '../src/ui/settings.js';
import * as store from '../src/data/store.js';
import * as auth from '../src/auth/auth.js';
import { getTheme } from '../src/ui/theme.js';

// Recent Node versions ship a native (experimental) `localStorage` global that
// happy-dom's vitest environment does not override, and it throws on every
// call. Install a real, spec-compliant in-memory Storage instead. (Same
// pattern as tests/theme.test.js — see the pitfall note in shared-context.)
function installMemoryLocalStorage() {
  const map = new Map();
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

const NAV_LABELS = [
  'My account',
  'My notifications & settings',
  'Developer',
  'My connections',
  'Language & region',
  'Settings',
  'Members',
  'Upgrade',
  'Billing',
  'Security',
  'Identity & provisioning',
  'Connections',
];

function navRowByLabel(label) {
  return Array.from(document.querySelectorAll('.set-nav-row'))
    .find((r) => r.querySelector('.set-nav-label').textContent === label);
}

function makeCtx(overrides = {}) {
  return {
    store,
    auth,
    toast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '';
  store.resetStore();
  store.initStore();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  document.body.innerHTML = '';
});

test('imports', async () => {
  await import('../src/ui/settings.js');
});

describe('nav', () => {
  test('renders all 12 nav items in order', () => {
    openSettings(makeCtx());
    const rows = document.querySelectorAll('.set-nav-row');
    expect(rows.length).toBe(12);
    expect(Array.from(rows).map((r) => r.querySelector('.set-nav-label').textContent)).toEqual(NAV_LABELS);
  });

  test('renders the "Workspace" section label', () => {
    openSettings(makeCtx());
    expect(document.querySelector('.set-nav-section').textContent).toBe('Workspace');
  });

  test('shows the session email in the nav header', () => {
    localStorage.setItem('ms:session', JSON.stringify({ email: 'ada@example.com', name: 'Ada', avatar: null, onboarded: true }));
    openSettings(makeCtx());
    expect(document.querySelector('.set-nav-header').textContent).toBe('ada@example.com');
  });

  test('clicking a nav row swaps the panel and marks it active', () => {
    openSettings(makeCtx());
    const membersRow = navRowByLabel('Members');
    membersRow.click();
    expect(membersRow.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('.set-panel-inner h2').textContent).toBe('Members');
    expect(document.body.textContent).toContain('These settings are coming soon.');
  });

  test('the other 8 stub nav items also render "H = label + coming soon"', () => {
    const stubs = ['My connections', 'Language & region', 'Settings', 'Upgrade', 'Billing', 'Security', 'Identity & provisioning', 'Connections'];
    for (const label of stubs) {
      openSettings(makeCtx());
      const row = navRowByLabel(label);
      row.click();
      expect(document.querySelector('.set-panel-inner h2').textContent).toBe(label);
      expect(document.body.textContent).toContain('These settings are coming soon.');
      document.body.innerHTML = '';
    }
  });
});

describe('default panel — My notifications & settings', () => {
  test('shows the three notification row titles', () => {
    openSettings(makeCtx());
    const titles = Array.from(document.querySelectorAll('.set-row-title')).map((n) => n.textContent);
    expect(titles).toContain('Mobile push notifications');
    expect(titles).toContain('Email notifications');
    expect(titles).toContain('Always send email notifications');
  });

  test('renders exact subtext copy', () => {
    openSettings(makeCtx());
    const subs = Array.from(document.querySelectorAll('.set-row-sub')).map((n) => n.textContent);
    expect(subs).toContain('Receive push notifications on mentions and comments via your mobile app');
    expect(subs).toContain('Receive email updates, including mentions and comment replies');
    expect(subs.some((s) => s.startsWith("Receive emails about activity in your workspace, even when you're active on the app"))).toBe(true);
  });

  test('Mobile push and Email notifications default on, Always-send defaults off', () => {
    openSettings(makeCtx());
    const switches = document.querySelectorAll('.set-switch');
    // order: push, email, always, (desktop open later)
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(switches[1].getAttribute('aria-checked')).toBe('true');
    expect(switches[2].getAttribute('aria-checked')).toBe('false');
  });

  test('renders the My settings and Privacy section headings', () => {
    openSettings(makeCtx());
    const hs = Array.from(document.querySelectorAll('.set-panel-inner h2')).map((h) => h.textContent);
    expect(hs).toEqual(['My notifications', 'My settings', 'Privacy']);
  });
});

describe('Appearance dropdown', () => {
  function openAppearanceMenu() {
    const btn = document.querySelector('.set-dd-appearance');
    btn.click();
  }

  test('selecting Dark calls setTheme and flips document.documentElement.dataset.theme', () => {
    openSettings(makeCtx());
    openAppearanceMenu();
    const item = Array.from(document.querySelectorAll('.set-dd-item')).find((i) => i.textContent === 'Dark');
    expect(item).toBeTruthy();
    item.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getTheme()).toBe('dark');
  });

  test('updates the visible label after picking an option', () => {
    openSettings(makeCtx());
    openAppearanceMenu();
    const item = Array.from(document.querySelectorAll('.set-dd-item')).find((i) => i.textContent === 'Dark');
    item.click();
    expect(document.querySelector('.set-dd-appearance .set-dd-label').textContent).toBe('Dark');
  });

  test('offers Light / Dark / Use system', () => {
    openSettings(makeCtx());
    openAppearanceMenu();
    const labels = Array.from(document.querySelectorAll('.set-dd-item')).map((i) => i.textContent);
    expect(labels).toEqual(['Light', 'Dark', 'Use system']);
  });
});

describe('prefs persist', () => {
  test('toggling "Always send email notifications" persists notifAlways=true to the store', () => {
    openSettings(makeCtx());
    const switches = document.querySelectorAll('.set-switch');
    switches[2].click(); // Always send email notifications
    expect(store.getPrefs().notifAlways).toBe(true);
    const raw = JSON.parse(localStorage.getItem('ms:prefs'));
    expect(raw.notifAlways).toBe(true);
  });

  test('toggling "Mobile push notifications" off persists notifPush=false', () => {
    openSettings(makeCtx());
    const switches = document.querySelectorAll('.set-switch');
    switches[0].click();
    expect(store.getPrefs().notifPush).toBe(false);
  });

  test('picking "Home" in Open on start persists startPage=home', () => {
    openSettings(makeCtx());
    document.querySelector('.set-dd-startpage').click();
    const item = Array.from(document.querySelectorAll('.set-dd-item')).find((i) => i.textContent === 'Home');
    item.click();
    expect(store.getPrefs().startPage).toBe('home');
  });

  test('toggling "Open links in desktop app" persists openDesktop=true', () => {
    openSettings(makeCtx());
    const switches = document.querySelectorAll('.set-switch');
    switches[3].click(); // desktop app switch
    expect(store.getPrefs().openDesktop).toBe(true);
  });

  test('picking a Show my view history option persists viewHistory', () => {
    openSettings(makeCtx());
    document.querySelector('.set-dd-viewhistory').click();
    const item = Array.from(document.querySelectorAll('.set-dd-item')).find((i) => i.textContent === 'Off');
    item.click();
    expect(store.getPrefs().viewHistory).toBe('off');
  });
});

describe('Privacy panel controls', () => {
  test('Cookie settings "Customize ›" link toasts Coming soon', () => {
    const ctx = makeCtx();
    openSettings(ctx);
    const link = Array.from(document.querySelectorAll('.set-link')).find((a) => a.textContent === 'Customize ›');
    link.click();
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  });

  test('the view-history row\'s "Learn more" link toasts Coming soon', () => {
    const ctx = makeCtx();
    openSettings(ctx);
    const link = Array.from(document.querySelectorAll('.set-link')).find((a) => a.textContent === 'Learn more');
    link.click();
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  });
});

describe('My account panel', () => {
  beforeEach(() => {
    localStorage.setItem('ms:session', JSON.stringify({ email: 'ada@example.com', name: 'Ada Lovelace', avatar: null, onboarded: true }));
  });

  function openAccountPanel(ctx) {
    openSettings(ctx, 'account');
  }

  test('renders "My account" heading and a Preferred name input pre-filled with session name', () => {
    openAccountPanel(makeCtx());
    expect(document.querySelector('.set-panel-inner h2').textContent).toBe('My account');
    const input = document.querySelector('.set-field-input');
    expect(input.value).toBe('Ada Lovelace');
  });

  test('editing Preferred name and firing change updates the session via ctx.auth', () => {
    openAccountPanel(makeCtx());
    const input = document.querySelector('.set-field-input');
    input.value = 'Ada L.';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(auth.getSession().name).toBe('Ada L.');
  });

  test('preferred name update does not touch the workspace name', () => {
    store.updateWorkspace({ name: "Ada's Mnemosphere", ownerEmail: 'ada@example.com' });
    openAccountPanel(makeCtx());
    const input = document.querySelector('.set-field-input');
    input.value = 'Ada L.';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(store.getWorkspace().name).toBe("Ada's Mnemosphere");
  });

  test('"Upload photo" click triggers the hidden file input', () => {
    openAccountPanel(makeCtx());
    const fileInput = document.querySelector('.set-avatar-input');
    const clickSpy = vi.spyOn(fileInput, 'click');
    const uploadBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Upload photo');
    uploadBtn.click();
    expect(clickSpy).toHaveBeenCalled();
  });

  test('"Change password" button toasts Coming soon', () => {
    const ctx = makeCtx();
    openAccountPanel(ctx);
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Change password');
    btn.click();
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  });
});

describe('modal chrome', () => {
  test('opens a 2-pane .mod-box.set-modal and closes via the close button', () => {
    openSettings(makeCtx());
    expect(document.querySelector('.mod-box.set-modal')).not.toBeNull();
    expect(document.querySelector('.set-nav')).not.toBeNull();
    expect(document.querySelector('.set-panel')).not.toBeNull();
    document.querySelector('.set-close').click();
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });

  test('defaults to the notifications panel when no panel arg given', () => {
    openSettings(makeCtx());
    expect(document.querySelector('.set-nav-row.is-active .set-nav-label').textContent).toBe('My notifications & settings');
  });

  test('opens directly on the requested panel', () => {
    openSettings(makeCtx(), 'billing');
    expect(document.querySelector('.set-nav-row.is-active .set-nav-label').textContent).toBe('Billing');
    expect(document.querySelector('.set-panel-inner h2').textContent).toBe('Billing');
  });
});
