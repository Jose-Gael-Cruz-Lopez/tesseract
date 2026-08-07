// @vitest-environment happy-dom
// Workspace settings panel — export / import (the "your pages can leave the
// browser" UI half; the store half is tests/store-export.test.js).
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { openSettings } from '../src/ui/settings.js';
import * as store from '../src/data/store.js';
import * as auth from '../src/auth/auth.js';

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
    value: storage, configurable: true, writable: true,
  });
}

function makeCtx(overrides = {}) {
  return { store, auth, toast: vi.fn(), ...overrides };
}

function navRowByLabel(label) {
  return Array.from(document.querySelectorAll('.set-nav-row'))
    .find((r) => r.querySelector('.set-nav-label').textContent === label);
}

function openWorkspacePanel(ctx = makeCtx()) {
  openSettings(ctx);
  navRowByLabel('Settings').click();
  return ctx;
}

function buttonByText(text) {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}

beforeEach(() => {
  installMemoryLocalStorage();
  document.body.innerHTML = '';
  store.resetStore();
  store.seedWorkspace({ name: 'Ada', email: 'ada@example.com' });
});

describe('workspace settings panel', () => {
  test('is a real panel (not the stub): rename, Export, and Import are present', () => {
    openWorkspacePanel();
    expect(document.body.textContent).not.toContain('These settings are coming soon.');
    expect(buttonByText('Export')).toBeTruthy();
    expect(buttonByText('Import…')).toBeTruthy();
    const titles = Array.from(document.querySelectorAll('.set-row-title')).map((n) => n.textContent);
    expect(titles).toContain('Export workspace');
    expect(titles).toContain('Import workspace');
  });

  test('renaming the workspace writes through the store', () => {
    openWorkspacePanel();
    const input = document.querySelector('.set-ws-name');
    input.value = 'Renamed HQ';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getWorkspace().name).toBe('Renamed HQ');
  });

  test('Export builds the snapshot from the store (download plumbing is best-effort)', () => {
    const spy = vi.spyOn(store, 'exportWorkspace');
    openWorkspacePanel();
    buttonByText('Export').click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('Import: picking a valid file shows a confirm step; confirming replaces the workspace', async () => {
    store.seedWorkspace({ name: 'Backup' });
    const file = new File([JSON.stringify(store.exportWorkspace())], 'backup.json', { type: 'application/json' });
    store.seedWorkspace({ name: 'Current' });

    const ctx = openWorkspacePanel();
    const input = document.querySelector('.set-import-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => { if (!buttonByText('Replace workspace')) throw new Error('confirm not shown'); });

    // Nothing replaced yet — the confirm is the gate.
    expect(store.getWorkspace().name).toBe("Current's Mnemosphere");
    buttonByText('Replace workspace').click();
    expect(store.getWorkspace().name).toBe("Backup's Mnemosphere");
    expect(ctx.toast).toHaveBeenCalledWith('Workspace imported.');
  });

  test('Import: Cancel dismisses the confirm and changes nothing', async () => {
    store.seedWorkspace({ name: 'Backup' });
    const file = new File([JSON.stringify(store.exportWorkspace())], 'backup.json');
    store.seedWorkspace({ name: 'Current' });

    openWorkspacePanel();
    const input = document.querySelector('.set-import-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => { if (!buttonByText('Cancel')) throw new Error('confirm not shown'); });

    buttonByText('Cancel').click();
    expect(buttonByText('Replace workspace')).toBeFalsy();
    expect(store.getWorkspace().name).toBe("Current's Mnemosphere");
  });

  test('Import: a non-JSON file toasts and never shows a confirm', async () => {
    const ctx = openWorkspacePanel();
    const input = document.querySelector('.set-import-input');
    Object.defineProperty(input, 'files', { value: [new File(['not json {'], 'junk.txt')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => { if (!ctx.toast.mock.calls.length) throw new Error('no toast yet'); });
    expect(ctx.toast).toHaveBeenCalledWith('That file is not a Mnemosphere export.');
    expect(buttonByText('Replace workspace')).toBeFalsy();
  });

  test('Import: a JSON file that fails validation toasts the store error on confirm', async () => {
    const junk = { format: 'mnemosphere-workspace', version: 99, workspace: {}, pages: [] };
    const ctx = openWorkspacePanel();
    const input = document.querySelector('.set-import-input');
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(junk)], 'old.json')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => { if (!buttonByText('Replace workspace')) throw new Error('confirm not shown'); });

    buttonByText('Replace workspace').click();
    expect(ctx.toast).toHaveBeenCalledWith('Unsupported export version: 99');
    expect(store.getWorkspace().name).toBe("Ada's Mnemosphere");
  });
});
