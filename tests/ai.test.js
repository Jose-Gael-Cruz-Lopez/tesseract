// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountAIBar, aiProvider } from '../src/ui/ai.js';

function makeCtx(overrides = {}) {
  return {
    store: { updatePage: vi.fn() },
    toast: vi.fn(),
    ...overrides,
  };
}

function makePage(overrides = {}) {
  return { id: 'page-1', title: 'Untitled', blocks: '', ...overrides };
}

function mockMatchMedia(reducedMotion) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reducedMotion,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Consumes an async generator by grouping its {line, word} tokens into an
// array of full-line strings.
async function collectLines(generator) {
  const lines = [];
  for await (const tok of generator) {
    if (!lines[tok.line]) lines[tok.line] = '';
    lines[tok.line] = lines[tok.line] ? `${lines[tok.line]} ${tok.word}` : tok.word;
  }
  return lines;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

test('imports', async () => {
  await import('../src/ui/ai.js');
});

describe('aiProvider.generate', () => {
  test('brainstorm prompt yields >=8 lines mentioning the extracted topic', async () => {
    vi.useFakeTimers();
    const promise = collectLines(aiProvider.generate('Brainstorm ideas on Design Thinking'));
    await vi.runAllTimersAsync();
    const lines = await promise;
    expect(lines.length).toBeGreaterThanOrEqual(8);
    const withTopic = lines.filter((l) => l.includes('Design Thinking'));
    expect(withTopic.length).toBeGreaterThanOrEqual(8);
  });

  test('blog prompt yields short paragraphs', async () => {
    vi.useFakeTimers();
    const promise = collectLines(aiProvider.generate('Write a blog post on remote work'));
    await vi.runAllTimersAsync();
    const lines = await promise;
    expect(lines.length).toBe(3);
  });

  test('outline prompt yields a numbered outline', async () => {
    vi.useFakeTimers();
    const promise = collectLines(aiProvider.generate('Outline on hiring'));
    await vi.runAllTimersAsync();
    const lines = await promise;
    expect(lines[0]).toMatch(/^1\./);
    expect(lines[1]).toMatch(/^2\./);
  });

  test('unmatched prompt falls back to two generic paragraphs', async () => {
    vi.useFakeTimers();
    const promise = collectLines(aiProvider.generate('something else entirely'));
    await vi.runAllTimersAsync();
    const lines = await promise;
    expect(lines.length).toBe(2);
  });

  test('respects prefers-reduced-motion by resolving without per-word delays', async () => {
    mockMatchMedia(true);
    const start = Date.now();
    const lines = await collectLines(aiProvider.generate('Brainstorm ideas on Testing'));
    const elapsed = Date.now() - start;
    expect(lines.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('mountAIBar — idle bar', () => {
  let bodyEl;
  let ctx;

  beforeEach(() => {
    bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);
    ctx = makeCtx();
  });

  test('renders the AI icon, placeholder input, and send button', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const bar = bodyEl.querySelector('.ai-bar');
    expect(bar).not.toBeNull();
    expect(bar.querySelector('.ai-bar-icon svg')).not.toBeNull();
    const input = bar.querySelector('.ai-bar-input');
    expect(input.placeholder).toBe('Ask AI to write anything...');
    expect(bar.querySelector('.ai-bar-send svg')).not.toBeNull();
  });

  test('send button gains .is-active once the input has text', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    const send = bodyEl.querySelector('.ai-bar-send');
    expect(send.classList.contains('is-active')).toBe(false);
    input.value = 'hello';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(send.classList.contains('is-active')).toBe(true);
  });

  test('focusing an empty input opens the "Draft with AI" dropdown with all 8 draft rows', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    input.dispatchEvent(new window.Event('focus'));

    const menu = document.querySelector('.ai-menu');
    expect(menu).not.toBeNull();
    expect(menu.querySelector('.ai-menu-label').textContent).toBe('Draft with AI');

    const rows = menu.querySelectorAll('.ai-menu-section-draft .ai-menu-row');
    expect(rows.length).toBe(8);
    const labels = [...rows].map((r) => r.querySelector('.ai-menu-row-label').textContent);
    expect(labels).toEqual([
      'Brainstorm ideas...',
      'Blog post...',
      'Outline...',
      'Social media post...',
      'Press release...',
      'Creative story...',
      'Essay...',
      'See more',
    ]);

    const labelEls = menu.querySelectorAll('.ai-menu-label');
    expect(labelEls[1].textContent).toBe('Insert AI blocks');
    expect(menu.querySelector('.ai-menu-divider')).not.toBeNull();

    // "Summary" lives in its own section after the divider, not among the 8
    // draft rows counted above.
    const insertRows = menu.querySelectorAll('.ai-menu-section-insert .ai-menu-row');
    expect(insertRows.length).toBe(1);
    expect(insertRows[0].querySelector('.ai-menu-row-label').textContent).toBe('Summary');
  });

  test('focusing a non-empty input does not open the dropdown', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    input.value = 'already typing';
    input.dispatchEvent(new window.Event('focus'));
    expect(document.querySelector('.ai-menu')).toBeNull();
  });

  test('clicking "Brainstorm ideas..." fills the input with "Brainstorm ideas on "', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    input.dispatchEvent(new window.Event('focus'));
    const row = [...document.querySelectorAll('.ai-menu-row')].find(
      (r) => r.querySelector('.ai-menu-row-label').textContent === 'Brainstorm ideas...'
    );
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(input.value).toBe('Brainstorm ideas on ');
    expect(document.querySelector('.ai-menu')).toBeNull();
  });

  test('"See more" toasts "Coming soon" and closes the dropdown', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    input.dispatchEvent(new window.Event('focus'));
    const seeMore = [...document.querySelectorAll('.ai-menu-row')].find(
      (r) => r.querySelector('.ai-menu-row-label').textContent === 'See more'
    );
    seeMore.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
    expect(document.querySelector('.ai-menu')).toBeNull();
  });

  test('"Summary" (Insert AI blocks) toasts "Coming soon"', () => {
    mountAIBar(bodyEl, makePage(), ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    input.dispatchEvent(new window.Event('focus'));
    const summary = [...document.querySelectorAll('.ai-menu-row')].find(
      (r) => r.querySelector('.ai-menu-row-label').textContent === 'Summary'
    );
    summary.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  });
});

describe('mountAIBar — streaming + done', () => {
  let bodyEl;
  let ctx;
  let page;

  beforeEach(() => {
    vi.useFakeTimers();
    bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);
    ctx = makeCtx();
    page = makePage();
  });

  async function submit(promptText) {
    mountAIBar(bodyEl, page, ctx);
    const input = bodyEl.querySelector('.ai-bar-input');
    input.value = promptText;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  test('submitting switches the bar to the streaming state', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    const bar = bodyEl.querySelector('.ai-bar');
    expect(bar.classList.contains('is-streaming')).toBe(true);
    expect(bar.querySelector('.ai-bar-status').textContent).toBe('AI is writing ⋯');
    expect(bar.querySelector('.ai-bar-tryagain').textContent).toBe('Try again ↻');
    expect(bar.querySelector('.ai-bar-stop').textContent).toBe('Stop esc');
  });

  test('streaming appends >=8 <li> elements containing the topic, then reaches the done state', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    const items = bodyEl.querySelectorAll('.ai-output li');
    expect(items.length).toBeGreaterThanOrEqual(8);
    const withTopic = [...items].filter((li) => li.textContent.includes('Design Thinking'));
    expect(withTopic.length).toBeGreaterThanOrEqual(8);

    expect(bodyEl.querySelector('.ai-output').classList.contains('ai-highlight')).toBe(true);
    const bar = bodyEl.querySelector('.ai-bar');
    expect(bar.classList.contains('is-done')).toBe(true);
    expect(bar.querySelector('.ai-bar-input').placeholder).toBe('Tell AI what to do next');
    expect(bar.querySelector('.ai-bar-disclaimer-text').textContent).toBe(
      'AI responses can be inaccurate or misleading. Learn more'
    );
  });

  test('the done state auto-opens the completion menu with the exact rows', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    const menu = document.querySelector('.ai-completion-menu');
    expect(menu).not.toBeNull();
    const rows = [...menu.querySelectorAll('.ai-completion-row')];
    const labels = rows.map((r) => r.querySelector('.ai-completion-label').textContent);
    expect(labels).toEqual(['✓ Done', '✎ Continue writing', '≣ Make longer', '↻ Try again', '✕ Close']);

    const closeRow = rows[rows.length - 1];
    expect(closeRow.querySelector('.ai-completion-hint').textContent).toBe('Escape');
    // only the Close row carries the Escape hint
    expect(rows[0].querySelector('.ai-completion-hint')).toBeNull();
  });

  test('Stop halts mid-stream: content stops growing and the bar reaches the done state', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.advanceTimersByTimeAsync(90); // a handful of words in

    const partialCount = bodyEl.querySelectorAll('.ai-output li').length;
    const partialText = bodyEl.querySelector('.ai-output').textContent;
    expect(partialCount).toBeGreaterThan(0);

    bodyEl.querySelector('.ai-bar-stop').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(5000); // way past full completion

    expect(bodyEl.querySelector('.ai-output').textContent).toBe(partialText);
    const items = bodyEl.querySelectorAll('.ai-output li');
    expect(items.length).toBeLessThan(10); // never reached the full 10-item brainstorm list
    expect(bodyEl.querySelector('.ai-bar').classList.contains('is-done')).toBe(true);
  });

  test('Escape halts mid-stream, same as clicking Stop', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.advanceTimersByTimeAsync(90);
    const partialText = bodyEl.querySelector('.ai-output').textContent;

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.advanceTimersByTimeAsync(5000);

    expect(bodyEl.querySelector('.ai-output').textContent).toBe(partialText);
  });

  test('Done fires ctx.store.updatePage with the generated HTML and destroys the bar', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    const doneRow = [...document.querySelectorAll('.ai-completion-row')].find(
      (r) => r.querySelector('.ai-completion-label').textContent === '✓ Done'
    );
    doneRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(ctx.store.updatePage).toHaveBeenCalledTimes(1);
    const [id, patch] = ctx.store.updatePage.mock.calls[0];
    expect(id).toBe('page-1');
    expect(patch.blocks).toContain('Design Thinking');
    expect(patch.blocks).toContain('<li>');

    // the bar chrome is gone but the generated content remains in the body
    expect(bodyEl.querySelector('.ai-bar')).toBeNull();
    expect(bodyEl.querySelector('.ai-output')).not.toBeNull();
    expect(document.querySelector('.ai-completion-menu')).toBeNull();
  });

  test('Close behaves like Done: persists and destroys', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    const closeRow = [...document.querySelectorAll('.ai-completion-row')].find(
      (r) => r.querySelector('.ai-completion-label').textContent === '✕ Close'
    );
    closeRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(ctx.store.updatePage).toHaveBeenCalledTimes(1);
    expect(bodyEl.querySelector('.ai-bar')).toBeNull();
  });

  test('Escape closes (persists) once in the done state', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(ctx.store.updatePage).toHaveBeenCalledTimes(1);
    expect(bodyEl.querySelector('.ai-bar')).toBeNull();
  });

  test('"Make longer" appends exactly 4 more items', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();
    const before = bodyEl.querySelectorAll('.ai-output li').length;

    const longerRow = [...document.querySelectorAll('.ai-completion-row')].find(
      (r) => r.querySelector('.ai-completion-label').textContent === '≣ Make longer'
    );
    longerRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await vi.runAllTimersAsync();

    const after = bodyEl.querySelectorAll('.ai-output li').length;
    expect(after).toBe(before + 4);
  });

  test('"Continue writing" re-streams and appends more content without clearing the existing list', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();
    const before = bodyEl.querySelectorAll('.ai-output li').length;

    const continueRow = [...document.querySelectorAll('.ai-completion-row')].find(
      (r) => r.querySelector('.ai-completion-label').textContent === '✎ Continue writing'
    );
    continueRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await vi.runAllTimersAsync();

    const after = bodyEl.querySelectorAll('.ai-output li').length;
    expect(after).toBeGreaterThan(before);
  });

  test('"Try again" from the completion menu discards the previous content and regenerates', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    const tryAgainRow = [...document.querySelectorAll('.ai-completion-row')].find(
      (r) => r.querySelector('.ai-completion-label').textContent === '↻ Try again'
    );
    tryAgainRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // mid-regeneration the list should have been cleared before refilling
    expect(bodyEl.querySelector('.ai-bar').classList.contains('is-streaming')).toBe(true);
    await vi.runAllTimersAsync();

    const items = bodyEl.querySelectorAll('.ai-output li');
    expect(items.length).toBe(10); // back to the base brainstorm count, not doubled
  });

  test('the disclaimer\'s "Learn more" and thumbs toast "Coming soon"', async () => {
    await submit('Brainstorm ideas on Design Thinking');
    await vi.runAllTimersAsync();

    bodyEl.querySelector('.ai-bar-learnmore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    bodyEl.querySelector('.ai-bar-thumb-up').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    bodyEl.querySelector('.ai-bar-thumb-down').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
    expect(ctx.toast).toHaveBeenCalledTimes(3);
  });
});

describe('mountAIBar — destroy()', () => {
  test('destroy() removes the bar and output, and does not persist', () => {
    vi.useFakeTimers();
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);
    const ctx = makeCtx();
    const handle = mountAIBar(bodyEl, makePage(), ctx);

    handle.destroy();

    expect(bodyEl.querySelector('.ai-bar')).toBeNull();
    expect(bodyEl.querySelector('.ai-output')).toBeNull();
    expect(ctx.store.updatePage).not.toHaveBeenCalled();
  });

  test('destroy() while the draft dropdown is open also removes the dropdown', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);
    const ctx = makeCtx();
    const handle = mountAIBar(bodyEl, makePage(), ctx);
    bodyEl.querySelector('.ai-bar-input').dispatchEvent(new window.Event('focus'));
    expect(document.querySelector('.ai-menu')).not.toBeNull();

    handle.destroy();

    expect(document.querySelector('.ai-menu')).toBeNull();
  });
});
