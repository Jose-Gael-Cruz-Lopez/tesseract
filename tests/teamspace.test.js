// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { openTeamspace } from '../src/ui/teamspace-modal.js';

function makeCtx(overrides = {}) {
  return {
    store: {
      addTeamspace: vi.fn((t) => ({ id: 'ts1', description: '', icon: null, ...t })),
      getWorkspace: vi.fn(() => ({ name: "Ada's Mnemosphere", ownerEmail: 'a@b.c', teamspaces: [] })),
    },
    toast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

test('imports', async () => {
  await import('../src/ui/teamspace-modal.js');
});

describe('openTeamspace', () => {
  test('renders the banner with trioAvatars illustration, headline, and close button', () => {
    openTeamspace(makeCtx());
    const banner = document.querySelector('.ts-banner');
    expect(banner).not.toBeNull();
    expect(banner.querySelector('svg')).not.toBeNull();
    expect(banner.textContent).toContain(
      'Create your first teamspace to start using Mnemosphere with your teammates'
    );
    expect(document.querySelector('.ts-close')).not.toBeNull();
  });

  test('renders the icon tile, name field, description field, and access row copy exactly', () => {
    const ctx = makeCtx();
    openTeamspace(ctx);

    expect(document.querySelector('.ts-icon-tile')).not.toBeNull();
    expect(document.querySelector('.ts-icon-caption').textContent).toBe('Choose icon');

    const nameLabel = [...document.querySelectorAll('.ts-label')].find((n) => n.textContent === 'Teamspace name');
    expect(nameLabel).not.toBeUndefined();
    const nameInput = document.querySelector('.ts-name-input');
    expect(nameInput.getAttribute('placeholder')).toBe('Acme Labs');
    expect(document.querySelector('.ts-name-sub').textContent).toBe(
      'Teamspaces are where your team organizes pages, permissions, and members'
    );

    const descLabel = [...document.querySelectorAll('.ts-label')].find((n) => n.textContent === 'Description (optional)');
    expect(descLabel).not.toBeUndefined();
    const descInput = document.querySelector('.ts-desc-input');
    expect(descInput.tagName).toBe('TEXTAREA');
    expect(descInput.getAttribute('placeholder')).toBe('Details about your teamspace');

    const access = document.querySelector('.ts-access-row');
    expect(access.querySelector('svg')).not.toBeNull();
    expect(access.textContent).toContain(
      "Everyone at Ada's Mnemosphere and new members will have access to this teamspace"
    );
  });

  test('renders the footer with the learn link and a disabled Create teamspace button', () => {
    openTeamspace(makeCtx());
    const learn = document.querySelector('.ts-learn');
    expect(learn.textContent).toBe('ⓘ Learn about teamspaces');
    const create = document.querySelector('.ts-create');
    expect(create.textContent).toBe('Create teamspace');
    expect(create.disabled).toBe(true);
  });

  test('icon tile shows "T" by default and updates live to the first letter of the typed name', () => {
    openTeamspace(makeCtx());
    const tile = document.querySelector('.ts-icon-tile');
    const nameInput = document.querySelector('.ts-name-input');

    expect(tile.textContent).toBe('T');

    nameInput.value = 'zephyr';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(tile.textContent).toBe('Z');

    nameInput.value = '';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(tile.textContent).toBe('T');
  });

  test('clicking the icon tile cycles through emoji options and back to the letter', () => {
    openTeamspace(makeCtx());
    const tile = document.querySelector('.ts-icon-tile');
    const initial = tile.textContent;
    expect(initial).toBe('T');

    tile.click();
    const afterOneClick = tile.textContent;
    expect(afterOneClick).not.toBe('T');

    tile.click();
    const afterTwoClicks = tile.textContent;
    expect(afterTwoClicks).not.toBe(afterOneClick);

    // Cycling all the way through returns to the letter.
    let guard = 0;
    while (tile.textContent !== 'T' && guard < 20) {
      tile.click();
      guard += 1;
    }
    expect(tile.textContent).toBe('T');
  });

  test('the Create teamspace button is disabled until a name is typed, then enables', () => {
    openTeamspace(makeCtx());
    const nameInput = document.querySelector('.ts-name-input');
    const create = document.querySelector('.ts-create');
    expect(create.disabled).toBe(true);

    nameInput.value = 'Acme Labs';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(create.disabled).toBe(false);

    nameInput.value = '   ';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(create.disabled).toBe(true);
  });

  test('clicking Create calls addTeamspace with the typed name/description, toasts, and closes', () => {
    const ctx = makeCtx();
    openTeamspace(ctx);

    const nameInput = document.querySelector('.ts-name-input');
    const descInput = document.querySelector('.ts-desc-input');
    nameInput.value = 'Acme Labs';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    descInput.value = 'Our team space';
    descInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.querySelector('.ts-create').click();

    expect(ctx.store.addTeamspace).toHaveBeenCalledTimes(1);
    expect(ctx.store.addTeamspace).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme Labs', description: 'Our team space' })
    );
    expect(ctx.toast).toHaveBeenCalledWith('Teamspace created');
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });

  test('clicking the disabled Create button does nothing', () => {
    const ctx = makeCtx();
    openTeamspace(ctx);
    document.querySelector('.ts-create').click();
    expect(ctx.store.addTeamspace).not.toHaveBeenCalled();
    expect(document.querySelector('.mod-scrim')).not.toBeNull();
  });

  test('clicking "Learn about teamspaces" toasts Coming soon and does not close the modal', () => {
    const ctx = makeCtx();
    openTeamspace(ctx);
    document.querySelector('.ts-learn').click();
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
    expect(document.querySelector('.mod-scrim')).not.toBeNull();
  });

  test('clicking the close button closes the modal', () => {
    openTeamspace(makeCtx());
    expect(document.querySelector('.mod-scrim')).not.toBeNull();
    document.querySelector('.ts-close').click();
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });
});
