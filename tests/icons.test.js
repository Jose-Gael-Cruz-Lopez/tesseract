import { describe, test, expect } from 'vitest';
import { ICONS } from '../src/ui/icons.js';

const REQUIRED_NAMES = [
  'search', 'updates', 'settings', 'page', 'pageFilled', 'chevron', 'plus',
  'more', 'collapse', 'expand', 'trash', 'templates', 'import', 'teamspace',
  'newPage', 'home', 'star', 'starFilled', 'comment', 'clock', 'share', 'ai',
  'send', 'checkbox', 'table', 'board', 'timeline', 'calendar', 'question',
  'close', 'back', 'emoji', 'image', 'link', 'lock', 'copy', 'duplicate',
  'moveTo', 'undo', 'history', 'analytics', 'export', 'connect', 'globeMark',
  'google', 'apple', 'mail', 'gear', 'info', 'arrowUpDown', 'enter',
];

test('imports', async () => {
  await import('../src/ui/icons.js');
});

describe('ICONS', () => {
  test.each(REQUIRED_NAMES)('%s is an inline <svg> string', (name) => {
    expect(typeof ICONS[name]).toBe('string');
    expect(ICONS[name]).toContain('<svg');
  });
});
