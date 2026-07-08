// Original ink-sketch illustrations for Mnemosphere.
//
// Hand-drawn line figures in the spirit of a quick pen sketch: thin
// currentColor strokes, sparse hatching, almost no fill, and slightly
// irregular (never perfectly straight/round) linework so it reads as
// drawn rather than vector-perfect. `stroke="currentColor"` lets every
// mark invert automatically in dark mode.
//
// These are original drawings — no artwork is copied from any reference.

const STROKE = 'stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"';

function svg(viewBox, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${STROKE}>${inner}</svg>`;
}

// Standing figure, waving, wearing a striped shirt. ~120x220 viewBox.
const character = svg(
  '0 0 120 220',
  `
  <ellipse cx="58" cy="34" rx="17" ry="18" />
  <circle cx="52" cy="32" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="64" cy="33" r="1.1" fill="currentColor" stroke="none" />
  <path d="M51 41 Q58 45 65 40" />
  <path d="M58 52 L57 60" />
  <path d="M40 62 Q40 58 58 60 Q77 58 78 63 L80 132 Q60 138 38 132 Z" />
  <path d="M42 78 Q59 82 77 77" />
  <path d="M41 92 Q59 96 78 91" />
  <path d="M41 106 Q59 110 79 105" />
  <path d="M41 120 Q59 124 79 119" />
  <path d="M40 66 Q22 70 15 47" />
  <path d="M14 46 L8 35" />
  <path d="M8 36 L1 28" />
  <path d="M4 33 L-1 24" />
  <path d="M12 40 L4 34" />
  <path d="M78 65 L86 128" />
  <path d="M46 133 L40 196 L33 197" />
  <path d="M71 133 L79 195 L86 197" />
  <path d="M31 199 L38 199" />
  <path d="M84 199 L91 199" />
  `);

// Two figures leaning over a shared document on a table.
const team = svg(
  '0 0 150 150',
  `
  <ellipse cx="42" cy="38" rx="14" ry="15" />
  <path d="M42 53 L41 60" />
  <path d="M25 100 Q26 68 42 62 Q59 68 60 100" />
  <path d="M45 70 Q60 80 70 88" />
  <path d="M69 87 L79 90" />
  <path d="M69 87 L74 96" />
  <ellipse cx="108" cy="40" rx="14" ry="15" />
  <path d="M108 55 L109 62" />
  <path d="M126 102 Q125 70 108 64 Q92 70 91 102" />
  <path d="M105 72 Q90 82 80 89" />
  <path d="M81 88 L71 91" />
  <path d="M81 88 L76 97" />
  <path d="M18 112 L132 112" />
  <path d="M58 92 L92 92 L92 112 L58 112 Z" />
  <path d="M63 98 L87 98" />
  <path d="M63 104 L82 104" />
  `);

// Seated figure writing in a notebook.
const personal = svg(
  '0 0 150 150',
  `
  <ellipse cx="66" cy="36" rx="15" ry="16" />
  <path d="M66 52 L65 60" />
  <path d="M40 118 Q40 66 66 62 Q92 66 93 116" />
  <path d="M69 74 Q86 88 98 99" />
  <path d="M97 98 L107 100" />
  <path d="M40 118 L38 140" />
  <path d="M93 116 L98 140" />
  <path d="M34 142 L104 142" />
  <path d="M55 108 L100 106 L102 128 L57 130 Z" />
  <path d="M60 113 L94 111" />
  <path d="M60 119 L88 117" />
  <path d="M60 125 L82 123" />
  <path d="M98 100 L112 96" />
  `);

// Standing figure carrying a stack of books.
const school = svg(
  '0 0 150 150',
  `
  <ellipse cx="70" cy="34" rx="15" ry="16" />
  <path d="M70 50 L69 58" />
  <path d="M46 130 Q46 66 70 60 Q94 66 95 128" />
  <path d="M57 71 Q49 74 43 79" />
  <path d="M95 76 Q107 88 111 100" />
  <path d="M50 132 L44 178" />
  <path d="M91 130 L98 178" />
  <path d="M38 180 L50 180" />
  <path d="M92 180 L104 180" />
  <path d="M4 94 L36 89 L37 102 L5 107 Z" />
  <path d="M7 85 L39 80 L40 93 L8 98 Z" />
  <path d="M10 76 L42 71 L43 84 L11 89 Z" />
  `);

// Open, empty envelope.
const inboxEmpty = svg(
  '0 0 150 120',
  `
  <path d="M14 40 L75 8 L136 40 L136 100 L14 100 Z" />
  <path d="M14 40 L75 68 L136 40" />
  <path d="M14 100 L58 62" />
  <path d="M136 100 L92 62" />
  `);

// Two empty speech bubbles.
const commentsEmpty = svg(
  '0 0 150 100',
  `
  <path d="M14 14 Q14 8 26 8 L82 8 Q94 8 94 20 L94 46 Q94 58 82 58 L36 58 L20 74 L23 57 Q14 55 14 42 Z" />
  <path d="M64 34 Q64 27 77 27 L120 27 Q133 27 133 39 L133 58 Q133 70 120 70 L96 70 L96 87 L79 70 Q64 69 64 55 Z" />
  `);

// Three round ink faces, evenly spaced (header avatar row).
const trioAvatars = svg(
  '0 0 150 60',
  `
  <circle cx="30" cy="30" r="19" />
  <circle cx="24" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="35" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <path d="M23 36 Q30 41 37 36" />
  <circle cx="75" cy="30" r="19" />
  <circle cx="69" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="80" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <path d="M68 36 Q75 41 82 36" />
  <circle cx="120" cy="30" r="19" />
  <circle cx="114" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="125" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <path d="M113 36 Q120 41 127 36" />
  `);

export const ART = {
  character,
  team,
  personal,
  school,
  inboxEmpty,
  commentsEmpty,
  trioAvatars,
};
