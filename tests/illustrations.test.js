import { test, expect } from 'vitest';
import { ART } from '../src/ui/illustrations.js';

const NAMES = [
  'character',
  'team',
  'personal',
  'school',
  'inboxEmpty',
  'commentsEmpty',
  'trioAvatars',
];

test('imports', async () => {
  await import('../src/ui/illustrations.js');
});

test('ART exports exactly the expected illustration keys', () => {
  expect(Object.keys(ART).sort()).toEqual([...NAMES].sort());
});

for (const name of NAMES) {
  test(`ART.${name} is a string containing <svg`, () => {
    expect(typeof ART[name]).toBe('string');
    expect(ART[name]).toContain('<svg');
  });
}

test('every illustration is a self-contained, balanced <svg> element', () => {
  for (const name of NAMES) {
    const svg = ART[name];
    const opens = (svg.match(/<svg[ >]/g) || []).length;
    const closes = (svg.match(/<\/svg>/g) || []).length;
    expect(opens, `${name} should have exactly one <svg> open tag`).toBe(1);
    expect(closes, `${name} should have exactly one </svg> close tag`).toBe(1);
    expect(svg.trim().startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  }
});

test('every illustration declares a viewBox', () => {
  for (const name of NAMES) {
    expect(ART[name]).toMatch(/viewBox="0 0 \d+ \d+"/);
  }
});

test('character uses the ~120x220 viewBox called for in the brief', () => {
  expect(ART.character).toMatch(/viewBox="0 0 120 220"/);
});

test('every illustration uses stroke="currentColor" so dark mode inverts it', () => {
  for (const name of NAMES) {
    expect(ART[name]).toContain('stroke="currentColor"');
  }
});

test('every illustration uses a thin 1.5px stroke, ink-sketch weight', () => {
  for (const name of NAMES) {
    expect(ART[name]).toContain('stroke-width="1.5"');
  }
});

test('trioAvatars draws three distinct round faces', () => {
  // Each face's head is a hand-drawn wobble: a closed <path> (ends in "Z")
  // built from several quadratic-bezier curves that approximate a circle.
  // Eye-dot <circle> marks are incidental decoration, not the faces
  // themselves, so we match the head-path pattern directly rather than
  // counting circle/ellipse primitives.
  const headPaths = (
    ART.trioAvatars.match(
      /<path d="M[\d.-]+ [\d.-]+(?: Q[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+){3,} Z" \/>/g,
    ) || []
  ).length;
  expect(headPaths).toBe(3);
});

test('commentsEmpty draws two speech bubbles', () => {
  // two bubble bodies means at least two closed <path> outlines
  const paths = (ART.commentsEmpty.match(/<path[ >]/g) || []).length;
  expect(paths).toBeGreaterThanOrEqual(2);
});
