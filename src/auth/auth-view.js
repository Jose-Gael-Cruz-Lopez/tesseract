// Auth + onboarding flow (Task 9).
//
// One mount, five hash routes: #/signup (default), #/login, and the three
// onboarding steps #/onboarding/{profile,usecase,about}. The signup/login
// screen has a two-phase inner state (enter email → paste code) that lives in
// component state rather than a separate route, matching the reference.
//
// Consumes: auth.js (mock, Supabase-shaped), ICONS, ART, and the shared toast.
// No top-level DOM access — every DOM touch happens inside mountAuth so the
// module import-smokes in a plain node environment.

import { ICONS } from '../ui/icons.js';
import { ART } from '../ui/illustrations.js';
import { toast, openPopover } from '../ui/popover.js';
import { supabaseEnabled, signInWithGoogle } from '../data/supabase.js';
import {
  signUp,
  logIn,
  verifyCode,
  completeProfile,
  getSession,
  setOnboarded,
  pendingEmail,
} from './auth.js';

const ROUTES = ['#/signup', '#/login', '#/onboarding/profile', '#/onboarding/usecase', '#/onboarding/about'];

const USECASES = [
  { key: 'team', art: 'team', title: 'For my team', desc: 'Collaborate on your docs, projects, and wikis.' },
  { key: 'personal', art: 'personal', title: 'For personal use', desc: 'Write better. Think more clearly. Stay organized.' },
  { key: 'school', art: 'school', title: 'For school', desc: 'Keep your notes, research, and tasks all in one place.' },
];

const WORK_OPTIONS = ['Product Design', 'Engineering', 'Marketing', 'Sales', 'Student', 'Other'];
const ROLE_OPTIONS = ['Solo', 'Team lead', 'Team member', 'Executive'];
const PLAN_OPTIONS = ['Notes', 'Docs', 'Wiki', 'Projects', 'Tasks', 'Journal'];

const PERSON_GLYPH =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7z"/></svg>';
const EYE_GLYPH =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

const GETTING_READY_MS = 1500;

// A single window `hashchange` listener delegates to the most recently mounted
// instance; re-mounting simply re-points `active` so stale, detached containers
// never receive updates.
let active = null;
let listenerReady = false;
function ensureHashListener() {
  if (listenerReady) return;
  listenerReady = true;
  window.addEventListener('hashchange', () => {
    if (active) active.handleHashChange();
  });
}

function node(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}
function textEl(tag, className, text) {
  const n = node(tag, className);
  if (text != null) n.textContent = text;
  return n;
}
function iconEl(tag, className, svg) {
  const n = node(tag, className);
  n.innerHTML = svg;
  return n;
}

function parseHash() {
  let h = '';
  try {
    h = window.location.hash || '';
  } catch {
    h = '';
  }
  return ROUTES.includes(h) ? h : '#/signup';
}

export function mountAuth(container, { onComplete } = {}) {
  const state = {
    route: '#/signup',
    mode: 'signup', // 'signup' | 'login'
    codeSent: false,
    email: '',
    avatar: null,
    name: '',
    password: '',
    usecase: null,
    work: '',
    role: '',
    plans: [],
  };

  const instance = { handleHashChange };
  active = instance;
  ensureHashListener();

  state.route = parseHash();
  applyRoute();
  render();

  return instance;

  // ---- routing ------------------------------------------------------------

  function applyRoute() {
    if (state.route === '#/signup' || state.route === '#/login') {
      state.mode = state.route === '#/login' ? 'login' : 'signup';
      state.codeSent = false;
    }
  }

  function handleHashChange() {
    const next = parseHash();
    if (next === state.route) return;
    state.route = next;
    applyRoute();
    render();
  }

  function go(route) {
    state.route = route;
    applyRoute();
    try {
      if (window.location.hash !== route) window.location.hash = route;
    } catch {
      /* ignore navigation errors */
    }
    render();
  }

  function collectProfile() {
    return {
      ...(getSession() || {}),
      usecase: state.usecase,
      work: state.work,
      role: state.role,
      plans: [...state.plans],
    };
  }

  // ---- render dispatch ----------------------------------------------------

  function render() {
    container.innerHTML = '';
    container.classList.add('au-mount');
    if (state.route === '#/signup' || state.route === '#/login') {
      container.appendChild(buildAuth());
    } else if (state.route === '#/onboarding/profile') {
      container.appendChild(buildProfileView());
    } else if (state.route === '#/onboarding/usecase') {
      container.appendChild(buildUsecaseView());
    } else if (state.route === '#/onboarding/about') {
      container.appendChild(buildAboutView());
    }
  }

  // ---- signup / login -----------------------------------------------------

  function buildAuth() {
    const root = node('div', 'au');

    const brand = node('div', 'au-brand');
    brand.appendChild(iconEl('span', 'au-brand-mark', ICONS.globeMark));
    brand.appendChild(textEl('span', 'au-brand-name', 'Mnemosphere'));
    root.appendChild(brand);

    const center = node('div', 'au-center');
    const col = node('div', 'au-col');
    col.appendChild(textEl('h1', 'au-title', state.mode === 'login' ? 'Log in' : 'Sign up'));
    col.appendChild(state.codeSent ? buildCodeStep() : buildEmailStep());
    col.appendChild(buildSaml());
    col.appendChild(buildOAuth());
    center.appendChild(col);
    root.appendChild(center);

    root.appendChild(buildAuthFooter());
    return root;
  }

  function buildEmailStep() {
    const step = node('div', 'au-step');
    step.appendChild(textEl('label', 'au-label', 'Work email'));

    const input = node('input', 'au-input au-email');
    input.type = 'email';
    input.placeholder = 'Enter your email address...';
    input.value = state.email;
    input.addEventListener('input', () => { state.email = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitEmail(); }
    });
    step.appendChild(input);

    const btn = textEl('button', 'au-btn au-btn-cta au-continue-email', 'Continue with email');
    btn.type = 'button';
    btn.addEventListener('click', submitEmail);
    step.appendChild(btn);
    return step;
  }

  function buildCodeStep() {
    const step = node('div', 'au-step');
    const isLogin = state.mode === 'login';

    const filled = node('div', 'au-email-filled');
    const input = node('input', 'au-input au-email');
    input.type = 'email';
    input.value = state.email;
    input.addEventListener('input', () => { state.email = input.value; });
    filled.appendChild(input);

    const clear = iconEl('button', 'au-clear', ICONS.close);
    clear.type = 'button';
    clear.setAttribute('aria-label', 'Clear email');
    clear.addEventListener('click', () => {
      state.email = '';
      state.codeSent = false;
      render();
    });
    filled.appendChild(clear);
    step.appendChild(filled);

    step.appendChild(textEl(
      'p',
      'au-helper',
      isLogin
        ? 'We just sent you a temporary login code. Please check your inbox and paste the login code below.'
        : 'We just sent you a temporary sign up code. Please check your inbox and paste the sign up code below.'
    ));

    step.appendChild(textEl('label', 'au-label au-code-label', isLogin ? 'Login code' : 'Sign up code'));

    const code = node('input', 'au-input au-code-input');
    code.type = 'text';
    code.placeholder = 'Paste login code';
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitCode(); }
    });
    step.appendChild(code);

    const submit = textEl('button', 'au-btn au-btn-cta au-code-submit', isLogin ? 'Continue with login code' : 'Create new account');
    submit.type = 'button';
    submit.addEventListener('click', submitCode);
    step.appendChild(submit);
    return step;
  }

  function buildSaml() {
    const p = node('p', 'au-saml');
    p.appendChild(document.createTextNode('You can also '));
    const link = textEl('a', 'au-link', 'continue with SAML SSO');
    link.href = '#';
    link.addEventListener('click', (e) => { e.preventDefault(); toast('Coming soon'); });
    p.appendChild(link);
    return p;
  }

  function buildOAuth() {
    const group = node('div', 'au-oauth-group');
    group.appendChild(oauthButton(ICONS.google, 'Continue with Google', 'au-oauth-google', onGoogle));
    // GitHub sign-in grants the Developer side too — a full-page redirect through
    // canopy's OAuth (same-origin), returning to the app root signed in.
    group.appendChild(oauthButton(ICONS.github, 'Continue with GitHub', 'au-oauth-github', onGitHub));
    group.appendChild(oauthButton(ICONS.apple, 'Continue with Apple', 'au-oauth-apple', () => toast('Coming soon')));
    return group;
  }

  function onGitHub() {
    try { window.location.href = '/auth/login?return=/'; } catch { /* navigation blocked */ }
  }

  // Real Google OAuth when Supabase is configured; otherwise the placeholder.
  function onGoogle(btn) {
    if (!supabaseEnabled) {
      toast('Coming soon');
      return;
    }
    btn.disabled = true;
    signInWithGoogle().catch(() => {
      btn.disabled = false;
      toast('Could not start Google sign-in');
    });
  }

  function oauthButton(icon, label, cls, onClick) {
    const btn = node('button', `au-btn au-btn-oauth ${cls}`);
    btn.type = 'button';
    btn.appendChild(iconEl('span', 'au-oauth-icon', icon));
    btn.appendChild(textEl('span', 'au-oauth-label', label));
    btn.addEventListener('click', () => (onClick ? onClick(btn) : toast('Coming soon')));
    return btn;
  }

  function buildAuthFooter() {
    const p = node('p', 'au-footer');
    p.appendChild(document.createTextNode(
      'By clicking "Continue with Apple/Google/Email/SAML" above, you acknowledge that you have read and understood, and agree to Mnemosphere\'s '
    ));
    const terms = textEl('a', 'au-link', 'Terms & Conditions');
    terms.href = '#';
    terms.addEventListener('click', (e) => { e.preventDefault(); toast('Coming soon'); });
    p.appendChild(terms);
    p.appendChild(document.createTextNode(' and '));
    const privacy = textEl('a', 'au-link', 'Privacy Policy');
    privacy.href = '#';
    privacy.addEventListener('click', (e) => { e.preventDefault(); toast('Coming soon'); });
    p.appendChild(privacy);
    p.appendChild(document.createTextNode('.'));
    return p;
  }

  async function submitEmail() {
    const input = container.querySelector('.au-email');
    const email = (input ? input.value : state.email).trim();
    if (!email) return;
    state.email = email;
    if (state.mode === 'login') await logIn(email);
    else await signUp(email);
    state.codeSent = true;
    render();
  }

  async function submitCode() {
    const input = container.querySelector('.au-code-input');
    const code = input ? input.value : '';
    if (!code || !code.trim()) return;
    const res = await verifyCode(state.email, code);
    if (!res || !res.ok) return;
    // Login short-circuit: only when a session already exists for THIS email —
    // logging in with a different address must still onboard a fresh account.
    const session = getSession();
    if (state.mode === 'login' && session && session.email === state.email) {
      if (typeof onComplete === 'function') onComplete(session);
      return;
    }
    go('#/onboarding/profile');
  }

  // ---- onboarding: profile ------------------------------------------------

  function buildProfileView() {
    const root = node('div', 'au-onboard au-onboard-profile');
    const col = node('div', 'au-onboard-col');

    col.appendChild(textEl('h2', 'au-h2', 'Welcome to Mnemosphere'));
    col.appendChild(textEl('p', 'au-sub', 'First things first, tell us a bit about yourself.'));

    // Avatar + photo picker.
    const avatarWrap = node('div', 'au-avatar-wrap');
    const avatar = node('div', 'au-avatar');
    if (state.avatar) {
      const img = node('img', 'au-avatar-img');
      img.src = state.avatar;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = PERSON_GLYPH;
    }
    avatarWrap.appendChild(avatar);

    const file = node('input', 'au-file');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { state.avatar = reader.result; render(); };
      reader.readAsDataURL(f);
    });
    avatarWrap.appendChild(file);

    const photoLink = textEl('button', 'au-photo-link', 'Add a photo');
    photoLink.type = 'button';
    photoLink.addEventListener('click', () => file.click());
    avatarWrap.appendChild(photoLink);
    col.appendChild(avatarWrap);

    // Name.
    col.appendChild(textEl('label', 'au-label', 'What should we call you?'));
    const name = node('input', 'au-input au-name');
    name.type = 'text';
    name.placeholder = 'e.g. Ada Lovelace, Ada, AL';
    name.value = state.name;
    col.appendChild(name);

    // Password with reveal toggle.
    col.appendChild(textEl('label', 'au-label', 'Set a password'));
    const passWrap = node('div', 'au-pass-wrap');
    const pass = node('input', 'au-input au-password');
    pass.type = 'password';
    pass.placeholder = 'New password';
    pass.value = state.password;
    passWrap.appendChild(pass);
    const eye = iconEl('button', 'au-eye', EYE_GLYPH);
    eye.type = 'button';
    eye.setAttribute('aria-label', 'Show password');
    eye.addEventListener('click', () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
      eye.classList.toggle('is-on', pass.type === 'text');
    });
    passWrap.appendChild(eye);
    col.appendChild(passWrap);

    // Continue.
    const cont = textEl('button', 'au-blue-btn au-profile-continue', 'Continue');
    cont.type = 'button';
    cont.disabled = true;
    col.appendChild(cont);

    const sync = () => { cont.disabled = !(name.value.trim() && pass.value.length >= 4); };
    name.addEventListener('input', () => { state.name = name.value; sync(); });
    pass.addEventListener('input', () => { state.password = pass.value; sync(); });
    sync();
    cont.addEventListener('click', async () => {
      if (cont.disabled) return;
      await completeProfile({ name: name.value.trim(), password: pass.value, avatar: state.avatar });
      go('#/onboarding/usecase');
    });

    // Footer.
    const footer = node('div', 'au-onboard-footer');
    const line1 = node('p', 'au-foot-line');
    line1.appendChild(document.createTextNode("You're creating an account for "));
    line1.appendChild(textEl('strong', 'au-footer-email', pendingEmail() || state.email || ''));
    line1.appendChild(document.createTextNode('.'));
    footer.appendChild(line1);

    const line2 = node('p', 'au-foot-line');
    line2.appendChild(document.createTextNode("If you don't intend to set up a new account, you can "));
    const relink = textEl('a', 'au-link', 'log in with another email');
    relink.href = '#';
    relink.addEventListener('click', (e) => { e.preventDefault(); go('#/signup'); });
    line2.appendChild(relink);
    line2.appendChild(document.createTextNode('.'));
    footer.appendChild(line2);
    col.appendChild(footer);

    root.appendChild(col);
    root.appendChild(buildCharacter());
    return root;
  }

  // ---- onboarding: use case -----------------------------------------------

  function buildUsecaseView() {
    const root = node('div', 'au-onboard au-onboard-usecase');
    const body = node('div', 'au-onboard-body');

    body.appendChild(textEl('h2', 'au-h2', 'How are you planning to use Mnemosphere?'));
    body.appendChild(textEl('p', 'au-sub', "We'll streamline your setup experience accordingly."));

    const cont = textEl('button', 'au-blue-btn au-usecase-continue', 'Continue');
    cont.type = 'button';
    cont.disabled = state.usecase == null;

    const cards = node('div', 'au-usecase-cards');
    USECASES.forEach((uc) => {
      const card = node('button', 'au-usecase-card');
      card.type = 'button';
      card.dataset.usecase = uc.key;
      if (state.usecase === uc.key) card.classList.add('is-selected');
      card.appendChild(node('span', 'au-card-radio'));
      card.appendChild(iconEl('div', 'au-card-art', ART[uc.art]));
      card.appendChild(textEl('div', 'au-card-title', uc.title));
      card.appendChild(textEl('div', 'au-card-desc', uc.desc));
      card.addEventListener('click', () => {
        state.usecase = uc.key;
        cards.querySelectorAll('.au-usecase-card').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        cont.disabled = false;
      });
      cards.appendChild(card);
    });
    body.appendChild(cards);

    cont.addEventListener('click', () => {
      if (cont.disabled) return;
      go('#/onboarding/about');
    });
    body.appendChild(cont);

    root.appendChild(body);
    root.appendChild(buildCharacter());
    return root;
  }

  // ---- onboarding: about --------------------------------------------------

  function buildAboutView() {
    const root = node('div', 'au-onboard au-onboard-about');
    const body = node('div', 'au-onboard-body au-form');

    body.appendChild(textEl('h2', 'au-h2', 'Tell us about yourself'));
    body.appendChild(textEl('p', 'au-sub', "We'll customize your Mnemosphere experience based on your choice."));

    body.appendChild(selectField('What kind of work do you do?', WORK_OPTIONS, 'work'));
    body.appendChild(selectField('What is your role?', ROLE_OPTIONS, 'role'));
    body.appendChild(multiField('What are you planning to do in Mnemosphere?'));

    const cont = textEl('button', 'au-blue-btn au-about-continue', 'Continue');
    cont.type = 'button';
    cont.addEventListener('click', beginGettingReady);
    body.appendChild(cont);

    const skip = textEl('button', 'au-skip', 'Skip');
    skip.type = 'button';
    skip.addEventListener('click', beginGettingReady);
    body.appendChild(skip);

    root.appendChild(body);
    root.appendChild(buildCharacter());
    return root;
  }

  function selectField(labelText, options, key) {
    const field = node('div', 'au-select-field');
    field.appendChild(textEl('label', 'au-label', labelText));
    const sel = node('select', 'au-input au-select');
    const placeholder = textEl('option', null, 'Select response');
    placeholder.value = '';
    sel.appendChild(placeholder);
    options.forEach((o) => {
      const opt = textEl('option', null, o);
      opt.value = o;
      if (state[key] === o) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { state[key] = sel.value; });
    field.appendChild(sel);
    return field;
  }

  function multiField(labelText) {
    const field = node('div', 'au-select-field');
    field.appendChild(textEl('label', 'au-label', labelText));

    const trigger = node('button', 'au-input au-select au-multi-trigger');
    trigger.type = 'button';
    const setLabel = () => {
      trigger.textContent = state.plans.length ? `${state.plans.length} selected` : 'Choose one or more...';
    };
    setLabel();

    trigger.addEventListener('click', () => {
      openPopover(trigger, {
        className: 'au-multi-pop',
        placement: 'bottom-start',
        build: (popRoot) => {
          PLAN_OPTIONS.forEach((opt) => {
            const row = node('button', 'au-multi-opt');
            row.type = 'button';
            if (state.plans.includes(opt)) row.classList.add('is-checked');
            row.appendChild(iconEl('span', 'au-multi-check', ICONS.checkbox));
            row.appendChild(textEl('span', 'au-multi-label', opt));
            row.addEventListener('click', () => {
              const i = state.plans.indexOf(opt);
              if (i >= 0) state.plans.splice(i, 1);
              else state.plans.push(opt);
              row.classList.toggle('is-checked');
              setLabel();
            });
            popRoot.appendChild(row);
          });
        },
      });
    });

    field.appendChild(trigger);
    return field;
  }

  function beginGettingReady() {
    const form = container.querySelector('.au-form');
    if (form) form.classList.add('is-dimmed');

    const overlay = node('div', 'au-getting-ready');
    const card = node('div', 'au-ready-card');
    card.appendChild(node('span', 'au-spinner'));
    card.appendChild(textEl('span', 'au-ready-text', 'Getting ready...'));
    overlay.appendChild(card);
    container.appendChild(overlay);

    setTimeout(() => {
      try { setOnboarded(); } catch { /* storage disabled */ }
      if (typeof onComplete === 'function') onComplete(collectProfile());
    }, GETTING_READY_MS);
  }

  function buildCharacter() {
    return iconEl('div', 'au-character', ART.character);
  }
}
