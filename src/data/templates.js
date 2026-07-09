// Template catalog (19.png rail). Pure data — consumed by the templates modal
// (rail + preview card) and by anything that instantiates a template page.
//
// Each entry: { id, name, icon, category, description, madeBy, build() } where
// `build()` returns a fresh page partial (safe to hand straight to
// `createPage`). The two seeded database configs (To-dos, Reading List) are
// re-exported builds of the constants in seed.js — never re-written here — so
// a template-created database is structurally identical to the seeded one and
// renders through the same `renderDatabase`.

import { TEMPLATE_TODOS, TEMPLATE_READING } from './seed.js';

// Design System database (20.png gallery / 23.png view options). Columns
// Name/Status/Type; the gallery view carries an unset Status quick-filter chip
// per 20.png's "Status ⌄ + Add filter" bar.
const TEMPLATE_DESIGN_SYSTEM = {
  type: 'database',
  columns: [
    { id: 'name', name: 'Name', kind: 'title' },
    {
      id: 'status',
      name: 'Status',
      kind: 'select',
      options: [
        { label: 'Current', color: 'green' },
        { label: 'Needs Update', color: 'yellow' },
      ],
    },
    {
      id: 'type',
      name: 'Type',
      kind: 'select',
      options: [
        { label: '#a11y', color: 'blue' },
        { label: 'Roboto', color: 'gray' },
        { label: '🟡', color: 'yellow' },
      ],
    },
  ],
  rows: [
    { id: 'ds-1', cells: { name: 'Accessibility', status: 'Current', type: '#a11y' } },
    { id: 'ds-2', cells: { name: 'Typography', status: 'Needs Update', type: 'Roboto' } },
    { id: 'ds-3', cells: { name: 'Colors', status: 'Current', type: '' } },
    { id: 'ds-4', cells: { name: 'Icons', status: 'Current', type: '🟡' } },
  ],
  views: [
    { id: 'ds-view-gallery', name: 'Design System', layout: 'gallery', filters: [{ colId: 'status', value: null }], groupBy: null },
    { id: 'ds-view-list', name: 'List View', layout: 'table', filters: [], groupBy: null },
    { id: 'ds-view-status', name: 'By Status', layout: 'table', filters: [], groupBy: 'status' },
  ],
  activeView: 'ds-view-gallery',
};

// A simple one-paragraph doc page — the build() for every non-rich template.
const docBuild = (name, icon, intro) => () => ({
  title: name,
  icon: { type: 'emoji', value: icon },
  blocks: `<p>${intro}</p>`,
});

// {id, name, icon, category, description, build} → catalog entry.
const entry = (id, name, icon, category, description, build) => ({
  id,
  name,
  icon,
  category,
  description,
  madeBy: 'Mnemosphere',
  build,
});

// {…same, intro} → catalog entry whose build() is a simple doc page.
const doc = (id, name, icon, category, description, intro) =>
  entry(id, name, icon, category, description, docBuild(name, icon, intro));

export const TEMPLATES = [
  // ---- Suggested ----
  entry(
    'todo-list',
    'To-do list',
    '✔️',
    'Suggested',
    'Simple task management — create, organize, and track your tasks.',
    () => ({
      title: 'To-dos',
      icon: { type: 'emoji', value: '✔️' },
      blocks: structuredClone(TEMPLATE_TODOS),
    }),
  ),
  doc(
    'projects-tasks',
    'Projects & tasks',
    '✅',
    'Suggested',
    'Track every project and the tasks inside it, all in one place.',
    'Use this page to keep projects and their tasks side by side, so nothing slips through the cracks.',
  ),
  doc(
    'projects-tasks-sprints',
    'Projects, tasks & sprints',
    '🏃',
    'Suggested',
    'Plan sprints, assign tasks, and keep projects moving.',
    'Plan your sprints here: list the projects in flight, break them into tasks, and review at the end of every cycle.',
  ),
  doc(
    'meetings',
    'Meetings',
    '🗓️',
    'Suggested',
    'One home for agendas, notes, and action items from every meeting.',
    'Capture the agenda before the meeting, notes during it, and action items after — all on one page.',
  ),
  doc(
    'docs',
    'Docs',
    '📄',
    'Suggested',
    'A simple home for your team’s documents.',
    'Keep specs, guides, and write-ups together so your team always knows where to look.',
  ),

  // ---- Design ----
  doc(
    'design-sprint',
    'Design Sprint',
    '⚡',
    'Design',
    'Run a five-day design sprint from map to prototype to test.',
    'Map the problem on Monday, sketch on Tuesday, decide on Wednesday, prototype on Thursday, and test on Friday.',
  ),
  entry(
    'design-system',
    'Design System',
    '🖌',
    'Design',
    'A design system is a great way to keep everyone aligned. Use this template to document design patterns, assets, and brand, and make assets downloadable for everyone on your team.',
    () => ({
      title: 'Design System',
      icon: { type: 'emoji', value: '🖌' },
      blocks: structuredClone(TEMPLATE_DESIGN_SYSTEM),
    }),
  ),
  doc(
    'design-portfolio',
    'Design Portfolio',
    '🎨',
    'Design',
    'Showcase your best work with case studies and process notes.',
    'Collect your favorite projects here, with a short story about the problem, the process, and the result for each.',
  ),
  doc(
    'user-research-db',
    'User Research Database',
    '🔬',
    'Design',
    'Store interviews, insights, and participants in one searchable place.',
    'Log every interview and study here so insights stay searchable long after the research wraps up.',
  ),
  doc(
    'remote-brainstorming',
    'Remote Brainstorming',
    '💡',
    'Design',
    'Collect and vote on ideas with your team, wherever they are.',
    'Drop ideas here as they come, then group, discuss, and vote when the whole team is together.',
  ),

  // ---- Life ----
  entry(
    'reading-list',
    'Reading List',
    '📚',
    'Life',
    'The modern day reading list includes books, articles, podcasts, and videos.',
    () => ({
      title: 'Reading List',
      icon: { type: 'emoji', value: '📚' },
      blocks: structuredClone(TEMPLATE_READING),
    }),
  ),
  doc(
    'habit-tracker',
    'Habit Tracker',
    '📈',
    'Life',
    'Build better habits by tracking them one day at a time.',
    'List the habits you want to build and check in daily — small streaks add up.',
  ),
  doc(
    'simple-budget',
    'Simple Budget',
    '💵',
    'Life',
    'Track income and spending without the spreadsheet headache.',
    'Note what comes in and what goes out each month, and watch where your money actually goes.',
  ),
  doc(
    'weekly-todo',
    'Weekly To-do List',
    '📝',
    'Life',
    'Plan your week with a fresh list every Monday.',
    'Write down what this week needs from you, then enjoy crossing things off one by one.',
  ),
  doc(
    'travel-planner',
    'Travel Planner',
    '✈️',
    'Life',
    'Itineraries, bookings, and packing lists for every trip.',
    'Keep flights, stays, and day-by-day plans together so the only surprises on your trip are good ones.',
  ),

  // ---- Product management ----
  doc(
    'one-on-one-notes',
    '1:1 Notes',
    '🤝',
    'Product management',
    'A running doc for every 1:1 — topics, notes, and follow-ups.',
    'Add talking points before each 1:1 and capture follow-ups after, so every conversation builds on the last.',
  ),
  doc(
    'product-wiki',
    'Product Wiki',
    '📖',
    'Product management',
    'The single source of truth for how your product works.',
    'Document how the product works, why decisions were made, and where everything lives.',
  ),
  doc(
    'product-spec',
    'Product Spec',
    '📋',
    'Product management',
    'Define the problem, the solution, and the launch plan.',
    'Start with the problem, describe the solution, and spell out how you will know it worked.',
  ),
  doc(
    'vision-strategy',
    'Vision and strategy',
    '🧭',
    'Product management',
    'Write down where you are going and how you will get there.',
    'State the vision in one sentence, then lay out the bets that will get you there.',
  ),
];
