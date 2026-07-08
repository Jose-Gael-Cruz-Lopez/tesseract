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
  <path d="M58 16 Q74 15 76 33 Q78 51 59 53 Q41 55 40 35 Q39 17 58 16 Z" />
  <circle cx="52" cy="32" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="64" cy="33" r="1.1" fill="currentColor" stroke="none" />
  <path d="M51 42 Q59 46 65 39" />
  <path d="M53 47 L57 49" />
  <path d="M56 49 L60 51" />
  <path d="M59 47 L63 49" />
  <path d="M58 53 L57 60" />
  <path d="M40 62 Q39 58 58 60 Q77 57 78 63 L80 132 Q60 139 38 131 Z" />
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
  <path d="M42 23 Q55 22 57 37 Q58 53 43 55 Q27 56 27 39 Q26 24 42 23 Z" />
  <path d="M42 53 L41 60" />
  <path d="M25 100 Q27 68 42 62 Q58 67 60 100" />
  <path d="M45 70 Q60 80 70 88" />
  <path d="M69 87 L79 90" />
  <path d="M69 87 L74 96" />
  <path d="M72 81 L76 85" />
  <path d="M74 85 L78 89" />
  <path d="M76 89 L80 93" />
  <path d="M108 25 Q121 24 123 39 Q124 55 109 57 Q93 58 93 41 Q92 26 108 25 Z" />
  <path d="M108 55 L109 62" />
  <path d="M126 102 Q124 70 108 64 Q93 69 91 102" />
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
  <path d="M66 20 Q80 19 82 35 Q84 52 67 54 Q50 55 50 37 Q49 21 66 20 Z" />
  <path d="M67 54 L65 60" />
  <path d="M61 56 L65 58" />
  <path d="M64 58 L68 60" />
  <path d="M67 56 L71 58" />
  <path d="M40 118 Q39 66 66 62 Q93 66 93 116" />
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
  '0 0 150 190',
  `
  <path d="M70 18 Q84 17 86 33 Q88 50 71 52 Q54 53 54 35 Q53 19 70 18 Z" />
  <path d="M70 52 L69 58" />
  <path d="M46 130 Q45 66 70 60 Q95 66 95 128" />
  <path d="M57 71 Q49 74 43 79" />
  <path d="M95 76 Q107 88 111 100" />
  <path d="M50 132 L44 178" />
  <path d="M91 130 L98 178" />
  <path d="M38 180 L50 180" />
  <path d="M92 180 L104 180" />
  <path d="M4 94 L36 89 L37 102 L5 107 Z" />
  <path d="M7 85 L39 80 L40 93 L8 98 Z" />
  <path d="M10 76 L42 71 L43 84 L11 89 Z" />
  <path d="M14 79 L17 88" />
  <path d="M20 78 L23 87" />
  <path d="M26 77 L29 86" />
  `);

// Open, empty envelope.
const inboxEmpty = svg(
  '0 0 150 120',
  `
  <path d="M14 40 L74 8 L136 40 L136 100 L14 100 Z" />
  <path d="M14 40 L74 69 L136 40" />
  <path d="M14 100 L58 62" />
  <path d="M136 100 L92 62" />
  <path d="M22 90 L28 84" />
  <path d="M26 94 L32 88" />
  <path d="M30 98 L36 92" />
  `);

// Two empty speech bubbles.
const commentsEmpty = svg(
  '0 0 150 100',
  `
  <path d="M14 14 Q13 9 26 8 L82 8 Q95 8 94 21 L94 46 Q94 58 82 58 L36 58 L20 74 L23 57 Q14 55 14 42 Z" />
  <path d="M18 62 L23 58" />
  <path d="M21 66 L26 62" />
  <path d="M24 70 L29 66" />
  <path d="M64 34 Q63 26 78 27 L120 27 Q134 27 133 40 L133 58 Q133 71 120 70 L96 70 L96 87 L79 70 Q63 69 64 55 Z" />
  `);

// Three round ink faces, evenly spaced (header avatar row).
const trioAvatars = svg(
  '0 0 150 60',
  `
  <path d="M30 11 Q47 10 49 29 Q51 49 31 51 Q10 52 10 31 Q9 12 30 11 Z" />
  <circle cx="24" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="35" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <path d="M23 37 Q31 42 37 35" />
  <path d="M75 11 Q92 10 94 29 Q96 49 76 51 Q55 52 55 31 Q54 12 75 11 Z" />
  <circle cx="69" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="80" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <path d="M68 35 Q76 41 82 37" />
  <path d="M66 40 L69 44" />
  <path d="M69 42 L72 46" />
  <path d="M120 11 Q137 10 139 29 Q141 49 121 51 Q100 52 100 31 Q99 12 120 11 Z" />
  <circle cx="114" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <circle cx="125" cy="26" r="1.1" fill="currentColor" stroke="none" />
  <path d="M113 36 Q119 40 127 36" />
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
