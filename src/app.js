// App shell skeleton (Task 8). Builds the Notion-style frame — sidebar rail,
// topbar, content area with the globe behind a slide-over page panel — and
// mounts the globe. The sidebar/topbar placeholders and the console-logging
// globe hooks are replaced by the real surfaces + ctx wiring in Task 21.

import { initGlobe } from './globe/globe.js';

export function mountApp(root) {
  root.innerHTML = `
    <div class="shell">
      <aside class="shell-sidebar" id="shell-sidebar"></aside>
      <main class="shell-main">
        <header class="shell-topbar" id="shell-topbar"></header>
        <div class="shell-content">
          <div class="shell-globe" id="shell-globe"></div>
          <section class="shell-page" id="shell-page" aria-hidden="true"></section>
          <aside class="shell-comments" id="shell-comments"></aside>
        </div>
      </main>
    </div>`;

  // Temporary placeholder chrome (Task 21 mounts the real sidebar/topbar).
  const placeholder = (text) => {
    const d = document.createElement('div');
    d.className = 'shell-placeholder';
    d.textContent = text;
    return d;
  };
  root.querySelector('#shell-sidebar').appendChild(placeholder('Mnemosphere'));
  root.querySelector('#shell-topbar').appendChild(placeholder('Home'));

  const globe = initGlobe(root.querySelector('#shell-globe'), {
    // Task 21 routes these through ctx.openPage / the topbar. Until the editor
    // exists, opening a page just logs so the wiring stays verifiable.
    onOpenPage(pageId) { console.log('[mnemosphere] open page', pageId); },
    onHubFocus(pageId) { console.log('[mnemosphere] hub focus', pageId); },
  });

  return { globe };
}
