// The first-run workspace. `buildSeed()` returns the tree that `seedWorkspace`
// walks: an array of top-level page partials, each with a `children` array of
// sub-page partials. Top-level order is the sidebar order (7.png).
//
// The two database templates live here as plain constants so Task 14
// (`templates.js`) can re-export them without a phase-order dependency on
// itself. Seeded pages get a `structuredClone` of the template, so editing a
// seeded database never mutates the shared constant.

// ---------- doc-block helpers ----------

const h1 = (t) => `<h1>${t}</h1>`;
const h2 = (t) => `<h2>${t}</h2>`;
const p = (t) => `<p>${t}</p>`;
const callout = (t) => `<div class="ed-callout">${t}</div>`;
const todo = (t, checked = false) =>
  `<div class="ed-todo"><input type="checkbox"${checked ? ' checked' : ''}>${t}</div>`;

function gettingStartedBlocks() {
  return [
    h1('Welcome to Mnemosphere!'),
    p('Here are the basics:'),
    todo('Click anywhere and just start typing'),
    todo('Hit / to see all the types of content you can add — headers, videos, sub pages, etc.'),
    todo(
      'Highlight any text, and use the menu that pops up to <b>style</b> <i>your</i> <code>writing</code> however you like',
    ),
    todo('See the ⋮⋮ to the left of this checkbox on hover? Click and drag to move this line'),
    todo('Click the + New Page button at the bottom of your sidebar to add a new page'),
    todo('Click Templates in your sidebar to get started with pre-built pages'),
    '<details><summary>This is a toggle block. Click the little triangle to see more useful tips!</summary>' +
      p('Type "/" and start searching to insert any kind of block — text, headings, to-dos, tables, and more.') +
      p('Hover over a line and drag the ⋮⋮ handle to move it, or press + to add a new block beneath it.') +
      p('Drag any page in your sidebar onto another to nest it as a sub-page.') +
      '</details>',
    callout(
      '👉 Have a question? Click the ? at the bottom right for more guides, or to send us a message.',
    ),
  ].join('');
}

function quickNoteBlocks() {
  return [
    callout(
      "<b>Mnemosphere Tip:</b> Use this template to write quick notes you can reference later and quickly create a rich document. You can embed links, images, to-do's, and more.",
    ),
    h2('Jot down some text'),
    p('Type here to capture a thought before it slips away. Every note lives on your globe, one click from everything else.'),
    h2('Make a to-do list'),
    todo('Wake up', true),
    todo('Brush teeth', true),
    todo('Eat breakfast'),
    h2('Create sub-pages'),
  ].join('');
}

// Intro copy that sits above the Reading List database (7.png / Reading List
// template). Stored on the database config's `intro` field because a page's
// `blocks` is a single value — either a doc string or one database object — and
// the seed test requires the Reading List `blocks.type` to be `'database'`.
function readingListIntro() {
  return [
    p(
      "The modern day reading list includes more than just books. We've created a dashboard to help you track books, articles, podcasts, and videos. Each media type has its own view based on the Type property.",
    ),
    p(
      '✂️ One more thing… if you install the Mnemosphere Web Clipper, you can save links off the web directly to this table.',
    ),
    p(
      '👆 Click through the different database tabs to see other views. Sort content by status, author, type, or publisher.',
    ),
  ].join('');
}

// ---------- database templates ----------

// The To-dos database behind "Task List". A `checkbox` "Done" column carries the
// per-row completed state; Task 14 renders it left of the title cell.
export const TEMPLATE_TODOS = {
  type: 'database',
  columns: [
    { id: 'done', name: 'Done', kind: 'checkbox' },
    { id: 'task', name: 'Task name', kind: 'title' },
    { id: 'assign', name: 'Assign', kind: 'person' },
    { id: 'due', name: 'Due', kind: 'date' },
  ],
  rows: [
    { id: 'todo-1', cells: { done: false, task: 'Write project brief', assign: 'Sohrab Amin', due: 'November 30, 2022' } },
    { id: 'todo-2', cells: { done: true, task: 'Schedule team off-site', assign: 'David Choi', due: '' } },
    { id: 'todo-3', cells: { done: true, task: 'Build Admin console', assign: 'Tanner Goda', due: 'November 8, 2022' } },
    { id: 'todo-4', cells: { done: false, task: 'Draft launch blog post', assign: 'Christina Lin', due: '' } },
    { id: 'todo-5', cells: { done: false, task: 'Brainstorm on Share menu', assign: 'Jen Jackson', due: 'November 8, 2022' } },
    { id: 'todo-6', cells: { done: false, task: 'Come up with naming ideas', assign: 'Jake Trower', due: 'November 8, 2022' } },
  ],
  views: [{ id: 'todo-view-tasks', name: 'Tasks', layout: 'table', filters: [], groupBy: null }],
  activeView: 'todo-view-tasks',
};

// The Reading List database. Six views (All / grouped / per-type / podcasts),
// three select colors per option per the brief.
export const TEMPLATE_READING = {
  type: 'database',
  columns: [
    { id: 'name', name: 'Name', kind: 'title' },
    {
      id: 'type',
      name: 'Type',
      kind: 'select',
      options: [
        { label: 'Article', color: 'gray' },
        { label: 'TV Series', color: 'blue' },
        { label: 'Book', color: 'green' },
      ],
    },
    {
      id: 'status',
      name: 'Status',
      kind: 'select',
      options: [
        { label: 'Not started', color: 'gray' },
        { label: 'In progress', color: 'blue' },
        { label: 'Done', color: 'green' },
      ],
    },
    { id: 'score', name: 'Score', kind: 'stars' },
    { id: 'author', name: 'Author', kind: 'text' },
    { id: 'completed', name: 'Completed', kind: 'date' },
    { id: 'link', name: 'Link', kind: 'url' },
  ],
  rows: [
    {
      id: 'read-1',
      cells: {
        name: 'Who Will Teach Silicon Valley to Be Ethical?',
        type: 'Article',
        status: 'Not started',
        score: 0,
        author: 'Kara Swisher',
        completed: '',
        link: 'https://www.nytimes.com/2018/10/21/opinion/who-will-teach-silicon-valley-to-be-ethical.html',
      },
    },
    {
      id: 'read-2',
      cells: {
        name: 'Netflix: explained',
        type: 'TV Series',
        status: 'In progress',
        score: 0,
        author: 'Ezra Klein & Joe Posner',
        completed: '',
        link: '',
      },
    },
    {
      id: 'read-3',
      cells: {
        name: 'Brave New World',
        type: 'Book',
        status: 'Done',
        score: 5,
        author: 'Aldous Huxley',
        completed: 'March 1, 2022',
        link: '',
      },
    },
    {
      id: 'read-4',
      cells: {
        name: 'Crime and Punishment',
        type: 'Book',
        status: 'Done',
        score: 4,
        author: 'Fyodor Dostoevsky',
        completed: 'March 28, 2022',
        link: '',
      },
    },
    {
      id: 'read-5',
      cells: {
        name: 'Sapiens: A Brief History of Humankind',
        type: 'Book',
        status: 'Done',
        score: 5,
        author: 'Yuval Noah Harari',
        completed: 'March 1, 2022',
        link: '',
      },
    },
  ],
  views: [
    { id: 'read-view-all', name: 'All', layout: 'table', filters: [], groupBy: null },
    { id: 'read-view-status', name: 'Grouped by status', layout: 'table', filters: [], groupBy: 'status' },
    { id: 'read-view-books', name: 'Books', layout: 'table', filters: [{ colId: 'type', value: 'Book' }], groupBy: null },
    { id: 'read-view-articles', name: 'Articles', layout: 'table', filters: [{ colId: 'type', value: 'Article' }], groupBy: null },
    { id: 'read-view-tv', name: 'Film + TV', layout: 'table', filters: [{ colId: 'type', value: 'TV Series' }], groupBy: null },
    { id: 'read-view-podcasts', name: 'Podcasts', layout: 'table', filters: [], groupBy: null },
  ],
  activeView: 'read-view-all',
};

// ---------- seed tree ----------

const docs = (titles) => titles.map((title) => ({ title, blocks: '' }));

export function buildSeed() {
  return [
    {
      title: 'Getting Started',
      icon: { type: 'emoji', value: '👋' },
      blocks: gettingStartedBlocks(),
      children: docs(['Basics', 'Shortcuts', 'FAQ']),
    },
    {
      title: 'Quick Note',
      icon: { type: 'emoji', value: '📌' },
      blocks: quickNoteBlocks(),
      children: docs(['Groceries', 'Ideas', 'Scratchpad']),
    },
    {
      title: 'Personal Home',
      icon: { type: 'emoji', value: '🏠' },
      cover: { type: 'preset', value: 'gradient-red' },
      blocks: '',
      children: docs(['Habit tracker', 'Recipes', 'Workout plan']),
    },
    {
      title: 'Task List',
      icon: { type: 'emoji', value: '✔️' },
      blocks: structuredClone(TEMPLATE_TODOS),
      children: docs(['Work', 'Home', 'Errands']),
    },
    {
      title: 'Journal',
      icon: { type: 'emoji', value: '📔' },
      blocks: '',
      children: docs(['Morning pages', 'Gratitude log', 'Dream log']),
    },
    {
      title: 'Reading List',
      icon: { type: 'emoji', value: '📚' },
      cover: { type: 'preset', value: 'photo-books' },
      blocks: { ...structuredClone(TEMPLATE_READING), intro: readingListIntro() },
      children: docs(['2026 books', 'Articles', 'Podcast queue']),
    },
  ];
}
