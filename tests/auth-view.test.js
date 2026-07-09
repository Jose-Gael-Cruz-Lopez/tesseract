// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountAuth } from '../src/auth/auth-view.js';
import { signUp, completeProfile, setOnboarded } from '../src/auth/auth.js';
import { signInWithGoogle } from '../src/data/supabase.js';

// Treat Supabase as configured so the Google button exercises the real OAuth
// path (kicking off signInWithGoogle) rather than the placeholder toast.
vi.mock('../src/data/supabase.js', () => ({
  supabaseEnabled: true,
  signInWithGoogle: vi.fn(() => Promise.resolve()),
}));

// Node v25 ships a native localStorage global that happy-dom doesn't override
// and that throws without --localstorage-file; auth.js touches it, so install a
// real in-memory Storage (pattern copied from tests/theme.test.js).
function installMemoryLocalStorage() {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
}

let container;

beforeEach(() => {
  installMemoryLocalStorage();
  document.body.innerHTML = '';
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

test('imports', async () => {
  await import('../src/auth/auth-view.js');
});

describe('signup screen', () => {
  test('mounts the signup screen with the Sign up heading, wordmark, and all four continue paths', () => {
    mountAuth(container, {});

    expect(container.querySelector('.au-title').textContent).toBe('Sign up');
    expect(container.querySelector('.au-brand-name').textContent).toBe('Mnemosphere');

    // Work email field.
    const email = container.querySelector('.au-email');
    expect(email.placeholder).toBe('Enter your email address...');
    expect(container.querySelector('.au-label').textContent).toBe('Work email');

    // Four continue paths.
    expect(container.querySelector('.au-continue-email').textContent).toBe('Continue with email');
    expect(container.querySelector('.au-saml').textContent).toContain('You can also continue with SAML SSO');
    expect(container.querySelector('.au-oauth-google').textContent).toContain('Continue with Google');
    expect(container.querySelector('.au-oauth-apple').textContent).toContain('Continue with Apple');

    // Footer terms copy.
    const footer = container.querySelector('.au-footer');
    expect(footer.textContent).toBe(
      'By clicking "Continue with Apple/Google/Email/SAML" above, you acknowledge that you have read and understood, and agree to Mnemosphere\'s Terms & Conditions and Privacy Policy.'
    );
  });

  test('SAML and Apple toast "Coming soon"; Google starts real OAuth', () => {
    signInWithGoogle.mockClear();
    mountAuth(container, {});

    container.querySelector('.au-oauth-apple').click();
    expect(document.querySelector('.toast-chip').textContent).toBe('Coming soon');
    document.querySelector('.toast-chip').remove();

    container.querySelector('.au-saml .au-link').click();
    expect(document.querySelector('.toast-chip').textContent).toBe('Coming soon');
    document.querySelector('.toast-chip').remove();

    // With Supabase configured, Google kicks off OAuth instead of toasting.
    container.querySelector('.au-oauth-google').click();
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast-chip')).toBeNull();
  });

  test('submitting the email swaps to the code step with the temporary-code copy', async () => {
    mountAuth(container, {});
    const email = container.querySelector('.au-email');
    email.value = 'designer.monk98@gmail.com';
    container.querySelector('.au-continue-email').click();
    await flush();

    expect(container.querySelector('.au-helper').textContent).toBe(
      'We just sent you a temporary sign up code. Please check your inbox and paste the sign up code below.'
    );
    expect(container.querySelector('.au-code-label').textContent).toBe('Sign up code');
    expect(container.querySelector('.au-code-input').placeholder).toBe('Paste login code');
    expect(container.querySelector('.au-code-submit').textContent).toBe('Create new account');
    // Email now shown filled with a clear affordance.
    expect(container.querySelector('.au-email').value).toBe('designer.monk98@gmail.com');
    expect(container.querySelector('.au-clear')).not.toBeNull();
  });

  test('an empty code does nothing; a non-empty code advances to the profile step', async () => {
    mountAuth(container, {});
    container.querySelector('.au-email').value = 'ada@example.com';
    container.querySelector('.au-continue-email').click();
    await flush();

    // Empty code: no navigation.
    container.querySelector('.au-code-submit').click();
    await flush();
    expect(container.querySelector('.au-code-submit')).not.toBeNull();

    // Non-empty code: advance to profile.
    container.querySelector('.au-code-input').value = '123456';
    container.querySelector('.au-code-submit').click();
    await flush();
    expect(container.querySelector('.au-profile-continue')).not.toBeNull();
    expect(window.location.hash).toBe('#/onboarding/profile');
  });
});

describe('login screen', () => {
  test('renders login copy and reveals the login code step', async () => {
    mountAuth(container, {});
    navigate('#/login');

    expect(container.querySelector('.au-title').textContent).toBe('Log in');

    container.querySelector('.au-email').value = 'new@example.com';
    container.querySelector('.au-continue-email').click();
    await flush();

    expect(container.querySelector('.au-code-label').textContent).toBe('Login code');
    expect(container.querySelector('.au-code-submit').textContent).toBe('Continue with login code');
    expect(container.querySelector('.au-helper').textContent).toBe(
      'We just sent you a temporary login code. Please check your inbox and paste the login code below.'
    );
  });

  test('short-circuits to onComplete when a session already exists for the email', async () => {
    await signUp('grace@example.com');
    await completeProfile({ name: 'Grace', password: 'abcd', avatar: null });
    setOnboarded();

    const onComplete = vi.fn();
    mountAuth(container, { onComplete });
    navigate('#/login');

    container.querySelector('.au-email').value = 'grace@example.com';
    container.querySelector('.au-continue-email').click();
    await flush();

    container.querySelector('.au-code-input').value = '123456';
    container.querySelector('.au-code-submit').click();
    await flush();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('logging in with a different email onboards a fresh account instead of short-circuiting', async () => {
    // A session exists for grace, but the user logs in as bob.
    await signUp('grace@example.com');
    await completeProfile({ name: 'Grace', password: 'abcd', avatar: null });
    setOnboarded();

    const onComplete = vi.fn();
    mountAuth(container, { onComplete });
    navigate('#/login');

    container.querySelector('.au-email').value = 'bob@example.com';
    container.querySelector('.au-continue-email').click();
    await flush();

    container.querySelector('.au-code-input').value = '123456';
    container.querySelector('.au-code-submit').click();
    await flush();

    expect(onComplete).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/onboarding/profile');
  });
});

describe('profile step', () => {
  test('Continue is disabled until a name and a 4+ char password are entered', async () => {
    await signUp('ada@example.com');
    mountAuth(container, {});
    navigate('#/onboarding/profile');

    expect(container.querySelector('.au-h2').textContent).toBe('Welcome to Mnemosphere');
    const btn = container.querySelector('.au-profile-continue');
    expect(btn.disabled).toBe(true);

    const name = container.querySelector('.au-name');
    const pass = container.querySelector('.au-password');

    name.value = 'Ada';
    name.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(true); // password still empty

    pass.value = 'abc'; // too short
    pass.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(true);

    pass.value = 'abcd';
    pass.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(false);
  });

  test('shows the pending email in the footer and offers a link back to signup', async () => {
    await signUp('designer.monk98@gmail.com');
    mountAuth(container, {});
    navigate('#/onboarding/profile');

    expect(container.querySelector('.au-footer-email').textContent).toBe('designer.monk98@gmail.com');
    container.querySelector('.au-onboard-footer .au-link').click();
    expect(window.location.hash).toBe('#/signup');
  });
});

describe('use case step', () => {
  test('selecting a card enables Continue', () => {
    mountAuth(container, {});
    navigate('#/onboarding/usecase');

    expect(container.querySelector('.au-h2').textContent).toBe('How are you planning to use Mnemosphere?');
    const cards = container.querySelectorAll('.au-usecase-card');
    expect(cards.length).toBe(3);
    expect(container.textContent).toContain('For my team');
    expect(container.textContent).toContain('For personal use');
    expect(container.textContent).toContain('For school');

    const btn = container.querySelector('.au-usecase-continue');
    expect(btn.disabled).toBe(true);

    cards[1].click();
    expect(cards[1].classList.contains('is-selected')).toBe(true);
    expect(btn.disabled).toBe(false);
  });
});

describe('about step', () => {
  test('renders the labeled fields and the multi-select placeholder', () => {
    mountAuth(container, {});
    navigate('#/onboarding/about');

    expect(container.querySelector('.au-h2').textContent).toBe('Tell us about yourself');
    const labels = [...container.querySelectorAll('.au-label')].map((l) => l.textContent);
    expect(labels).toContain('What kind of work do you do?');
    expect(labels).toContain('What is your role?');
    expect(labels).toContain('What are you planning to do in Mnemosphere?');
    expect(container.querySelector('.au-multi-trigger').textContent).toBe('Choose one or more...');
  });

  test('Continue runs the "Getting ready" beat, then calls onComplete after 1500ms', () => {
    vi.useFakeTimers();
    try {
      const onComplete = vi.fn();
      mountAuth(container, { onComplete });
      navigate('#/onboarding/about');

      container.querySelector('.au-about-continue').click();
      expect(container.querySelector('.au-getting-ready')).not.toBeNull();
      expect(container.querySelector('.au-getting-ready').textContent).toContain('Getting ready...');
      expect(onComplete).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1499);
      expect(onComplete).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('Skip also runs the beat and calls onComplete', () => {
    vi.useFakeTimers();
    try {
      const onComplete = vi.fn();
      mountAuth(container, { onComplete });
      navigate('#/onboarding/about');

      container.querySelector('.au-skip').click();
      vi.advanceTimersByTime(1500);
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
