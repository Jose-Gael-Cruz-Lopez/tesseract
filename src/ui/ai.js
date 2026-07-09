// The AI writing surface: a floating bar mounted at the top of a page's
// body that drafts content with a mock streaming provider.
//
// No top-level DOM access — every DOM touch happens inside `mountAIBar`
// (or a helper it calls), so this module import-smokes safely.
//
// mountAIBar never imports the store/auth/theme/database modules directly:
// cross-surface effects (persisting the generated HTML, toasting) go
// through the `ctx` object handed to it, per shared-context.md.

import { ICONS } from './icons.js';
import { openPopover, el, toast as popoverToast } from './popover.js';

// ---------------------------------------------------------------- copy --

const DRAFT_ROWS = [
  { label: 'Brainstorm ideas...', fill: 'Brainstorm ideas on ' },
  { label: 'Blog post...', fill: 'Blog post on ' },
  { label: 'Outline...', fill: 'Outline on ' },
  { label: 'Social media post...', fill: 'Social media post on ' },
  { label: 'Press release...', fill: 'Press release on ' },
  { label: 'Creative story...', fill: 'Creative story on ' },
  { label: 'Essay...', fill: 'Essay on ' },
];

const COMPLETION_ROWS = [
  { glyph: '✓', label: 'Done', action: 'done' },
  { glyph: '✎', label: 'Continue writing', action: 'continue' },
  { glyph: '≣', label: 'Make longer', action: 'longer' },
  { glyph: '↻', label: 'Try again', action: 'tryagain' },
  { glyph: '✕', label: 'Close', action: 'close', hint: 'Escape' },
];

// A small pencil glyph used only by the draft-template rows in the dropdown
// (kept local — it isn't part of the shared ICONS set).
const PENCIL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5l4 4L7 21H3v-4z"/><path d="M13.3 6.7l4 4"/></svg>';

// ------------------------------------------------------ mock provider content --

const BRAINSTORM_TEMPLATES = [
  'Create a workshop on TOPIC for beginners',
  'Develop a mobile app that teaches TOPIC concepts',
  'Host a TOPIC hackathon for local businesses',
  'Publish a TOPIC guidebook for entrepreneurs',
  'Offer TOPIC consulting services for corporations',
  'Create a TOPIC curriculum for schools and universities',
  'Develop a TOPIC toolkit for designers',
  'Organize a TOPIC conference featuring industry experts',
  'Establish a TOPIC community for professionals to share ideas and resources',
  'Launch a TOPIC podcast series featuring interviews with designers and innovators',
  'Write a TOPIC newsletter for practitioners',
  'Design a TOPIC certification program for professionals',
  'Build a TOPIC resource library for teams',
  'Start a TOPIC meetup group in your city',
  'Record a TOPIC video course for online learners',
  'Draft a TOPIC style guide for internal teams',
  'Launch a TOPIC blog to share case studies',
  'Create TOPIC templates for common workflows',
  'Host a TOPIC webinar series for clients',
  'Compile a TOPIC reading list for new hires',
];

const BLOG_TEMPLATES = [
  'TOPIC is reshaping how teams think about their work, and this post breaks down the fundamentals in plain language.',
  'Getting started with TOPIC does not require special tools — a notebook, a willingness to ask questions, and a small pilot project are enough.',
  'The teams that get the most out of TOPIC treat it as an ongoing practice, revisiting what they learned every few months rather than running it once.',
  'A good rule of thumb with TOPIC is to start narrow: pick one real problem, work it all the way through, and only then generalize the approach.',
  'Skeptics of TOPIC usually come around once they see a concrete before-and-after from their own team, not a slide deck from someone else\'s.',
  'The biggest risk with TOPIC is not doing it wrong — it is stopping after the first attempt instead of building it into how the team normally works.',
];

const OUTLINE_TEMPLATES = [
  'Introduction to TOPIC',
  'Why TOPIC matters right now',
  'Core principles of TOPIC',
  'Common challenges with TOPIC',
  'Best practices for TOPIC',
  'Tools and resources for TOPIC',
  'Real-world examples of TOPIC',
  'Measuring success with TOPIC',
  'Future trends in TOPIC',
  'Conclusion and next steps',
];

const GENERIC_TEMPLATES = [
  'TOPIC is a broad idea, so it helps to start with one concrete question and let the details follow from there.',
  'A short first draft, even an imperfect one, usually teaches more about TOPIC than another hour of planning would.',
  'People rarely disagree about TOPIC itself — they disagree about where to start, which is a much smaller problem to solve.',
  'The fastest way to make progress on TOPIC is to write down what you already believe and then go looking for the parts that are wrong.',
];

const CONTENT_TYPES = {
  brainstorm: { templates: BRAINSTORM_TEMPLATES, defaultCount: 10 },
  blog: { templates: BLOG_TEMPLATES, defaultCount: 3 },
  outline: { templates: OUTLINE_TEMPLATES, defaultCount: 5, numbered: true },
  generic: { templates: GENERIC_TEMPLATES, defaultCount: 2 },
};

function pickContentType(prompt) {
  if (/brainstorm|idea/i.test(prompt)) return 'brainstorm';
  if (/blog|post/i.test(prompt)) return 'blog';
  if (/outline/i.test(prompt)) return 'outline';
  return 'generic';
}

function extractTopic(prompt) {
  const trimmed = prompt.trim();
  const m = /\bon\s+(.+)$/i.exec(trimmed);
  return (m ? m[1] : trimmed).trim() || 'this topic';
}

// Wraps around the template pool so repeated "Continue writing" / "Make
// longer" clicks always have more (recycled) content to append — this is a
// mock provider, not a real model, so recycling is an acceptable trade-off.
function wrapSlice(templates, offset, count) {
  const start = ((offset % templates.length) + templates.length) % templates.length;
  const doubled = templates.concat(templates);
  return doubled.slice(start, start + count);
}

function renderTemplate(tpl, topic, index, numbered) {
  const text = tpl.replace(/TOPIC/g, topic);
  return numbered ? `${index + 1}. ${text}` : text;
}

function buildLines(prompt, { offset = 0, count } = {}) {
  const topic = extractTopic(prompt);
  const cfg = CONTENT_TYPES[pickContentType(prompt)];
  const n = count == null ? cfg.defaultCount : count;
  return wrapSlice(cfg.templates, offset, n).map((tpl, i) => renderTemplate(tpl, topic, offset + i, cfg.numbered));
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock streaming provider. Yields `{ line, word }` tokens: `line` is a
 * 0-based index into the (canned) content for this call, `word` is the next
 * word of that line. Consumers group tokens by `line` to build one <li> per
 * line. Content is chosen by matching `prompt` against a few keywords; see
 * CONTENT_TYPES above. Honors prefers-reduced-motion (no per-word delay).
 */
export const aiProvider = {
  async *generate(prompt, opts = {}) {
    const lines = buildLines(prompt, opts);
    const delay = prefersReducedMotion() ? 0 : 30;
    for (let li = 0; li < lines.length; li++) {
      const words = lines[li].split(' ');
      for (let wi = 0; wi < words.length; wi++) {
        if (delay) await wait(delay);
        yield { line: li, word: words[wi] };
      }
    }
  },
};

// -------------------------------------------------------------- mount --

/**
 * Mount the AI writing bar into `bodyEl` (the page's editable body). Returns
 * `{ destroy() }`. `page` is the current page record; `ctx.store.updatePage`
 * persists the generated HTML on "Done"/"Close", `ctx.toast` surfaces
 * not-yet-wired controls.
 */
export function mountAIBar(bodyEl, page, ctx) {
  const ul = el('ul', 'ai-output');
  const bar = el('div', 'ai-bar');
  bodyEl.appendChild(ul);
  bodyEl.appendChild(bar);

  let state = 'idle'; // idle | streaming | done
  let runId = 0;
  let stopRequested = false;
  let lastPrompt = '';
  let lineCount = 0;
  let destroyed = false;
  let closeDraft = null;
  let closeCompletion = null;
  let inputEl = null;

  function toast(message) {
    if (ctx && typeof ctx.toast === 'function') ctx.toast(message);
    else popoverToast(message);
  }

  // ---------------- draft dropdown ----------------

  function isDraftOpen() {
    return !!document.querySelector('.pop-root.ai-menu');
  }

  function openDraftMenu(anchor) {
    if (isDraftOpen()) return;
    closeDraft = openPopover(anchor, {
      className: 'ai-menu',
      placement: 'bottom-start',
      build: (root, closePop) => buildDraftMenu(root, closePop),
    });
  }

  function closeDraftMenu() {
    if (closeDraft) closeDraft();
    closeDraft = null;
  }

  function buildDraftMenu(root, closePop) {
    const draftSection = el('div', 'ai-menu-section ai-menu-section-draft');
    draftSection.appendChild(el('div', 'ai-menu-label', 'Draft with AI'));

    for (const row of DRAFT_ROWS) {
      const btn = el('button', 'ai-menu-row');
      btn.type = 'button';
      btn.appendChild(el('span', 'ai-menu-row-icon', PENCIL_ICON));
      btn.appendChild(el('span', 'ai-menu-row-label', row.label));
      btn.addEventListener('click', () => {
        closePop();
        if (inputEl) {
          inputEl.value = row.fill;
          updateSendActive();
          inputEl.focus();
        }
      });
      draftSection.appendChild(btn);
    }

    const more = el('button', 'ai-menu-row ai-menu-row-more');
    more.type = 'button';
    more.appendChild(el('span', 'ai-menu-row-icon ai-menu-dots', '···'));
    more.appendChild(el('span', 'ai-menu-row-label', 'See more'));
    more.appendChild(el('span', 'ai-menu-row-chevron', '›'));
    more.addEventListener('click', () => {
      closePop();
      toast('Coming soon');
    });
    draftSection.appendChild(more);
    root.appendChild(draftSection);

    root.appendChild(el('div', 'ai-menu-divider'));

    const insertSection = el('div', 'ai-menu-section ai-menu-section-insert');
    insertSection.appendChild(el('div', 'ai-menu-label', 'Insert AI blocks'));

    const summary = el('button', 'ai-menu-row');
    summary.type = 'button';
    summary.appendChild(el('span', 'ai-menu-row-icon', ICONS.ai));
    summary.appendChild(el('span', 'ai-menu-row-label', 'Summary'));
    summary.addEventListener('click', () => {
      closePop();
      toast('Coming soon');
    });
    insertSection.appendChild(summary);
    root.appendChild(insertSection);
  }

  // ---------------- completion menu (done state) ----------------

  function isCompletionOpen() {
    return !!document.querySelector('.pop-root.ai-completion-menu');
  }

  function openCompletionMenu(anchor) {
    if (isCompletionOpen()) return;
    closeCompletion = openPopover(anchor, {
      className: 'ai-completion-menu',
      placement: 'top-start',
      build: (root, closePop) => buildCompletionMenu(root, closePop),
    });
  }

  function closeCompletionMenu() {
    if (closeCompletion) closeCompletion();
    closeCompletion = null;
  }

  function buildCompletionMenu(root, closePop) {
    for (const row of COMPLETION_ROWS) {
      const btn = el('button', 'ai-completion-row');
      btn.type = 'button';
      btn.appendChild(el('span', 'ai-completion-label', `${row.glyph} ${row.label}`));
      if (row.hint) btn.appendChild(el('span', 'ai-completion-hint', row.hint));
      btn.addEventListener('click', () => {
        closePop();
        runCompletionAction(row.action);
      });
      root.appendChild(btn);
    }
  }

  function runCompletionAction(action) {
    if (action === 'done' || action === 'close') persistAndClose();
    else if (action === 'continue') runStream(lastPrompt, 'continue');
    else if (action === 'longer') runStream(lastPrompt, 'longer');
    else if (action === 'tryagain') runStream(lastPrompt, 'tryagain');
  }

  // ---------------- bar rendering ----------------

  function updateSendActive() {
    const sendBtn = bar.querySelector('.ai-bar-send');
    if (sendBtn && inputEl) sendBtn.classList.toggle('is-active', inputEl.value.trim() !== '');
  }

  function renderInputRow(placeholder, onSubmit) {
    const row = el('div', 'ai-bar-row');
    row.appendChild(el('span', 'ai-bar-icon', ICONS.ai));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ai-bar-input';
    input.placeholder = placeholder;
    inputEl = input;

    const send = el('button', 'ai-bar-send', ICONS.send);
    send.type = 'button';

    function trySubmit() {
      const value = input.value.trim();
      if (!value) return;
      onSubmit(value);
    }

    input.addEventListener('focus', () => {
      if (state === 'idle' && input.value.trim() === '') openDraftMenu(input);
    });
    input.addEventListener('input', () => {
      updateSendActive();
      if (state !== 'idle') return;
      if (input.value.trim() === '') openDraftMenu(input);
      else closeDraftMenu();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        trySubmit();
      }
    });
    send.addEventListener('click', trySubmit);

    row.appendChild(input);
    row.appendChild(send);
    bar.appendChild(row);
    updateSendActive();
  }

  function renderStreamingBar() {
    const row = el('div', 'ai-bar-row');
    row.appendChild(el('span', 'ai-bar-icon', ICONS.ai));

    const status = el('span', 'ai-bar-status', 'AI is writing ');
    status.appendChild(el('span', 'ai-bar-dots', '⋯'));
    row.appendChild(status);

    const actions = el('div', 'ai-bar-actions');

    const tryAgain = document.createElement('button');
    tryAgain.type = 'button';
    tryAgain.className = 'ai-bar-tryagain';
    tryAgain.appendChild(document.createTextNode('Try again '));
    tryAgain.appendChild(el('span', 'ai-bar-glyph', '↻'));
    tryAgain.addEventListener('click', () => runStream(lastPrompt, 'tryagain'));

    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'ai-bar-stop';
    stop.appendChild(document.createTextNode('Stop '));
    stop.appendChild(el('span', 'ai-bar-hint', 'esc'));
    stop.addEventListener('click', () => {
      stopRequested = true;
    });

    actions.appendChild(tryAgain);
    actions.appendChild(stop);
    row.appendChild(actions);
    bar.appendChild(row);
  }

  function renderDisclaimerRow() {
    const row = el('div', 'ai-bar-disclaimer');

    const text = el('span', 'ai-bar-disclaimer-text');
    text.appendChild(document.createTextNode('AI responses can be inaccurate or misleading. '));
    const learnMore = el('button', 'ai-bar-learnmore', 'Learn more');
    learnMore.type = 'button';
    learnMore.addEventListener('click', () => toast('Coming soon'));
    text.appendChild(learnMore);

    const feedback = el('span', 'ai-bar-feedback');
    const up = el('button', 'ai-bar-thumb ai-bar-thumb-up', '👍');
    up.type = 'button';
    up.addEventListener('click', () => toast('Coming soon'));
    const down = el('button', 'ai-bar-thumb ai-bar-thumb-down', '👎');
    down.type = 'button';
    down.addEventListener('click', () => toast('Coming soon'));
    feedback.appendChild(up);
    feedback.appendChild(down);

    row.appendChild(text);
    row.appendChild(feedback);
    bar.appendChild(row);
  }

  function renderBar() {
    bar.innerHTML = '';
    inputEl = null;
    bar.className = 'ai-bar';
    if (state === 'streaming') {
      bar.classList.add('is-streaming');
      renderStreamingBar();
    } else if (state === 'done') {
      bar.classList.add('is-done');
      // A follow-up instruction typed here isn't wired to the mock
      // provider — surface that honestly rather than silently dropping it.
      renderInputRow('Tell AI what to do next', () => toast('Coming soon'));
      renderDisclaimerRow();
    } else {
      bar.classList.add('is-idle');
      renderInputRow('Ask AI to write anything...', handleIdleSubmit);
    }
  }

  // ---------------- streaming ----------------

  function handleIdleSubmit(promptText) {
    closeDraftMenu();
    runStream(promptText, 'initial');
  }

  async function runStream(promptText, mode) {
    lastPrompt = promptText;
    closeCompletionMenu();
    const myRun = ++runId;
    stopRequested = false;
    state = 'streaming';
    if (mode === 'initial' || mode === 'tryagain') {
      ul.replaceChildren();
      lineCount = 0;
    }
    ul.classList.remove('ai-highlight');
    renderBar();

    const offset = lineCount;
    const count = mode === 'longer' ? 4 : undefined;
    let currentLineIndex = -1;
    let currentLi = null;

    const iterator = aiProvider.generate(promptText, { offset, count });
    while (true) {
      if (myRun !== runId) return;
      if (stopRequested) break;
      const { value, done } = await iterator.next();
      if (myRun !== runId) return;
      if (done || stopRequested) break;
      if (value.line !== currentLineIndex) {
        currentLi = document.createElement('li');
        ul.appendChild(currentLi);
        currentLineIndex = value.line;
        lineCount++;
      }
      currentLi.textContent = currentLi.textContent ? `${currentLi.textContent} ${value.word}` : value.word;
    }

    if (myRun === runId) finishStreaming();
  }

  function finishStreaming() {
    ul.classList.add('ai-highlight');
    state = 'done';
    renderBar();
    openCompletionMenu(bar);
  }

  function persistAndClose() {
    ul.classList.remove('ai-highlight');
    teardown(true);
    ctx.store.updatePage(page.id, { blocks: bodyEl.innerHTML });
  }

  // ---------------- lifecycle ----------------

  function onDocKeydown(e) {
    if (e.key !== 'Escape') return;
    if (state === 'streaming') stopRequested = true;
    else if (state === 'done') persistAndClose();
  }

  function teardown(keepContent) {
    if (destroyed) return;
    destroyed = true;
    runId++; // invalidate any in-flight stream
    document.removeEventListener('keydown', onDocKeydown, true);
    closeDraftMenu();
    closeCompletionMenu();
    bar.remove();
    if (!keepContent) ul.remove();
  }

  document.addEventListener('keydown', onDocKeydown, true);
  renderBar();

  return {
    destroy() {
      teardown(false);
    },
  };
}
