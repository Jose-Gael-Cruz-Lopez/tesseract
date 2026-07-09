// The "Import" modal — 12 source cards (Evernote, Trello, Asana, Confluence,
// Text & Markdown, CSV, HTML, Word, Google Docs, Dropbox Paper, Quip,
// Workflowy). Text & Markdown / CSV / HTML wire up a real file import via a
// hidden <input type="file"> + FileReader; the other nine are stubs that
// toast "Coming soon". No top-level DOM access — every DOM touch happens
// inside openImport() so this module import-smokes. Surface modules never
// import each other; the new page is created via ctx.store and opened via
// ctx.openPage, never by importing another surface module directly.
//
// The brand marks below are original, simplified geometric interpretations
// (not copies of any product's logo/artwork), drawn monochrome with
// `currentColor` so they inherit `.imp-card-icon`'s `color: var(--text-2)`.

import { el, openModal } from './popover.js';

// ---------- small local helpers (no shared uuid export exists to import) ----------

function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Filename minus its extension: "My Notes.md" -> "My Notes".
function stripExt(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

// Minimal markdown-ish transform: "# " -> h1, "## " -> h2, "- " -> li
// (grouped into a <ul>), everything else -> an escaped <p>. Every line is
// HTML-escaped first so no source markup executes.
function mdToHtml(text) {
  const lines = String(text).split(/\r?\n/);
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      closeList();
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith('# ')) {
      closeList();
      html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
    } else if (line.startsWith('- ')) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// First row = column names (all `text` kind); remaining rows = table rows.
// No quoted-field handling — a minimal, "first row splits on commas" parse.
function parseCsv(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = (lines[0] || '').split(',').map((s) => s.trim());
  const columns = header.map((name) => ({ id: uid(), name, kind: 'text' }));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',');
    const cells = {};
    columns.forEach((col, i) => {
      cells[col.id] = (values[i] ?? '').trim();
    });
    return { id: uid(), cells };
  });
  const view = { id: uid(), name: 'Table', layout: 'table', filters: [], groupBy: null };
  return { type: 'database', columns, rows, views: [view], activeView: view.id };
}

// Strip <script>...</script> blocks, then neutralize any remaining bare or
// unclosed <script ...> / </script> tag (a malformed or truncated file can
// carry an unmatched opener the paired-strip misses); keep the rest as-is.
function sanitizeHtml(text) {
  return String(text)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?script\b[^>]*>?/gi, '');
}

function readFileAsText(file, onText) {
  const reader = new FileReader();
  reader.onload = () => onText(String(reader.result ?? ''));
  reader.readAsText(file);
}

// ---------- brand marks (20x20, currentColor only) ----------

function outlineMark(inner, strokeWidth = 1.6) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function filledMark(inner) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">${inner}</svg>`;
}

function letterMark(letter, fontSize = 12, family = 'Georgia, serif') {
  return filledMark(
    `<text x="12" y="16.8" text-anchor="middle" font-size="${fontSize}" font-weight="700" font-family="${family}">${letter}</text>`
  );
}

const MARK = {
  // Elephant-ish rounded silhouette outline (Evernote).
  evernote: outlineMark(
    '<path d="M12 3.5c-3.3 0-5.6 2.2-5.6 5.1 0 1 .3 1.9.9 2.6-1 1-1.6 2.5-1.6 4.1 0 3 2.5 5 5.4 5h1.5c2.9 0 5.1-2.2 5.3-5.1.1-1.3-.2-2.6-.9-3.6.6-.8 1-1.8 1-2.9 0-3-2.7-5.2-6-5.2z"/><path d="M9 9.4h.01"/><path d="M15 9.4h.01"/><path d="M9.2 16.3c.9.7 2 1.1 2.8 1.1"/>'
  ),
  // A board with two bars of differing height (Trello).
  trello: outlineMark(
    '<rect x="3.5" y="4" width="17" height="16" rx="2"/><rect x="6.3" y="7" width="4.4" height="7.5" rx="1"/><rect x="13.3" y="7" width="4.4" height="10.5" rx="1"/>'
  ),
  // Three dots arranged in a triangle (Asana).
  asana: filledMark('<circle cx="12" cy="6.2" r="2.6"/><circle cx="6.4" cy="16" r="2.6"/><circle cx="17.6" cy="16" r="2.6"/>'),
  // Two overlapping wave swooshes (Confluence).
  confluence: outlineMark(
    '<path d="M3.5 15.5c3-5.5 6-7 9-3.5s6 2 8-1.5"/><path d="M3.5 9.5c3 5.5 6 7 9 3.5s6-2 8 1.5" opacity="0.55"/>'
  ),
  // "Aa" glyph (Text & Markdown).
  text: letterMark('Aa', 11),
  // A grid of table cells (CSV).
  csv: outlineMark(
    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="3.5" y1="14.5" x2="20.5" y2="14.5"/><line x1="9.5" y1="4.5" x2="9.5" y2="19.5"/><line x1="15.5" y1="4.5" x2="15.5" y2="19.5"/>',
    1.5
  ),
  // "</>" code brackets (HTML).
  html: outlineMark(
    '<polyline points="8.5 8 4.5 12 8.5 16"/><polyline points="15.5 8 19.5 12 15.5 16"/><line x1="13.2" y1="6.5" x2="10.8" y2="17.5"/>',
    1.8
  ),
  // Folded-corner doc outline + "W" glyph (Word).
  word: outlineMark(
    '<path d="M6.5 3.5h8l4 4v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4"/><text x="12" y="17.3" text-anchor="middle" font-size="7" font-weight="700" font-family="sans-serif" fill="currentColor" stroke="none">W</text>',
    1.4
  ),
  // Folded-corner doc outline + text lines (Google Docs).
  'google-docs': outlineMark(
    '<path d="M6.5 3.5h8l4 4v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4"/><line x1="8.3" y1="12" x2="15.7" y2="12"/><line x1="8.3" y1="15" x2="15.7" y2="15"/><line x1="8.3" y1="18" x2="13" y2="18"/>',
    1.4
  ),
  // An open box with flaps folded outward (Dropbox Paper).
  'dropbox-paper': outlineMark(
    '<path d="M4 10.5 12 6l8 4.5-8 4.5-8-4.5z"/><path d="M4 10.5v6.2L12 21l8-4.3v-6.2"/><path d="M12 15v6"/>'
  ),
  // "Q" glyph (Quip).
  quip: letterMark('Q', 13),
  // A small nested-bullet outline tree (Workflowy).
  workflowy: outlineMark(
    '<circle cx="5.5" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><line x1="5.5" y1="7" x2="5.5" y2="18.5"/><circle cx="10.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><line x1="7" y1="10.5" x2="9.2" y2="10.5"/><line x1="10.5" y1="12" x2="10.5" y2="18.5"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/><line x1="10.7" y1="15" x2="13.6" y2="15"/><circle cx="10.5" cy="19" r="1.1" fill="currentColor" stroke="none"/><line x1="7" y1="19" x2="9.2" y2="19"/>'
  ),
};

// Card order is exact copy fidelity — the label list is asserted verbatim
// (and in this order) by tests/import-modal.test.js.
const SOURCES = [
  { id: 'evernote', label: 'Evernote', icon: MARK.evernote, note: 'Get $5 in credit' },
  { id: 'trello', label: 'Trello', icon: MARK.trello },
  { id: 'asana', label: 'Asana', icon: MARK.asana },
  { id: 'confluence', label: 'Confluence', icon: MARK.confluence },
  { id: 'text', label: 'Text & Markdown', icon: MARK.text, kind: 'text' },
  { id: 'csv', label: 'CSV', icon: MARK.csv, kind: 'csv' },
  { id: 'html', label: 'HTML', icon: MARK.html, kind: 'html' },
  { id: 'word', label: 'Word', icon: MARK.word },
  { id: 'google-docs', label: 'Google Docs', icon: MARK['google-docs'] },
  { id: 'dropbox-paper', label: 'Dropbox Paper', icon: MARK['dropbox-paper'] },
  { id: 'quip', label: 'Quip', icon: MARK.quip },
  { id: 'workflowy', label: 'Workflowy', icon: MARK.workflowy },
];

export function openImport(ctx) {
  let close;

  close = openModal({
    className: 'imp-modal',
    build(box, closeFn) {
      close = closeFn;

      // ---------- header ----------
      const header = el('div', 'imp-header');
      header.appendChild(el('div', 'imp-title', 'Import'));
      const learn = el('span', 'imp-learn', 'ⓘ Learn about importing');
      learn.tabIndex = 0;
      learn.addEventListener('click', () => ctx.toast('Coming soon'));
      header.appendChild(learn);
      box.appendChild(header);

      // ---------- hidden file inputs ----------
      const inputText = document.createElement('input');
      inputText.type = 'file';
      inputText.accept = '.md,.txt';
      inputText.className = 'imp-input-text imp-hidden-input';

      const inputCsv = document.createElement('input');
      inputCsv.type = 'file';
      inputCsv.accept = '.csv';
      inputCsv.className = 'imp-input-csv imp-hidden-input';

      const inputHtml = document.createElement('input');
      inputHtml.type = 'file';
      inputHtml.accept = '.html';
      inputHtml.className = 'imp-input-html imp-hidden-input';

      box.appendChild(inputText);
      box.appendChild(inputCsv);
      box.appendChild(inputHtml);

      function parentForImport() {
        return typeof ctx.currentPageId === 'function' ? ctx.currentPageId() : null;
      }

      function finishImport(page) {
        ctx.openPage(page.id);
        close();
        ctx.toast('Imported');
      }

      function wireFileInput(input, toBlocks) {
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          input.value = '';
          if (!file) return;
          readFileAsText(file, (text) => {
            const page = ctx.store.createPage({
              title: stripExt(file.name),
              blocks: toBlocks(text),
              parentId: parentForImport(),
            });
            finishImport(page);
          });
        });
      }

      wireFileInput(inputText, mdToHtml);
      wireFileInput(inputCsv, parseCsv);
      wireFileInput(inputHtml, sanitizeHtml);

      // ---------- source grid ----------
      const grid = el('div', 'imp-grid');
      for (const source of SOURCES) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'imp-card';
        card.dataset.id = source.id;
        card.appendChild(el('span', 'imp-card-icon', source.icon));
        card.appendChild(el('span', 'imp-card-label', source.label));
        if (source.note) card.appendChild(el('span', 'imp-card-note', source.note));

        card.addEventListener('click', () => {
          if (source.kind === 'text') inputText.click();
          else if (source.kind === 'csv') inputCsv.click();
          else if (source.kind === 'html') inputHtml.click();
          else ctx.toast('Coming soon');
        });

        grid.appendChild(card);
      }
      box.appendChild(grid);
    },
  });

  return close;
}
