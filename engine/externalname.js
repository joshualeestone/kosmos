'use strict';
/* #3311: the one cleaner for a name or label that arrived from another Kosmos+
   account (federation). No dependencies, so the seat manager and the message
   store can both use it without pulling each other in. */

const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
const INVISIBLE = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u115F\u1160\u3164\uFFA0\u2800]/gu;

/* A name from outside, made safe to show beside local names. Every Unicode
   format character goes first (\p{Cf}: zero-width space and joiners, soft
   hyphen, word joiner, BOM, LRM/RLM/ALM, bidi embeddings, overrides and
   isolates), so "Spl\u200binter" cannot pass for a local "Splinter". The same
   class communitysite.scrubAuthorName strips, and for the same reason. NFKC
   then folds lookalike forms (fullwidth letters). The fallback enumerates the
   class for an engine without \p{Cf}. */
function externalName(v, max) {
  // Only a string or a number is a name; anything else from outside is none (and
  // String() on some objects throws).
  let s = typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  try { s = s.replace(/\p{Cf}/gu, ''); }
  catch { s = s.replace(/[\u00ad\u061c\u200b-\u200f\u2060-\u2064\u202a-\u202e\u2066-\u2069\ufeff]/g, ''); }
  s = s.normalize('NFKC');
  // Invisible yet not \p{Cf}: variation selectors (text can be smuggled in them)
  // and the blank letters (Hangul fillers, braille blank) a name can hide behind.
  s = s.replace(INVISIBLE, '');
  // Cut by code point, never mid-pair: a lone surrogate would be stored, shown,
  // and folded into a folder name as U+FFFD (the joinedProjectName rule).
  return byCodePoint(s.replace(CONTROL, ' ').replace(/[\n\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim(), max);
}

/* The first `max` code points of `s`. */
function byCodePoint(s, max) {
  return s.length <= max ? s : Array.from(s).slice(0, max).join('');
}

module.exports = { externalName, INVISIBLE, byCodePoint };
