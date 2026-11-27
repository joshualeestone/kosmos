'use strict';
/**
 * kosmos#9179: whether a task's own words could pass for one of the board's marks, and the quoted form that cannot.
 *
 * In an agent's "Your projects" (projects.blockBody), a task line is `  - task N of P: <words><marks>`. A title such as
 * "pay it [built: done and waiting]" on OPEN work would talk the agent out of the task, and one ending "[on hold: ...]"
 * would be read by holdsOf (which reads a hold as the line's LAST mark) as a hold. So a title that uses a mark word at
 * all is printed QUOTED, said to be the task's own words, and its line then ends in that note, never in a hold.
 *
 * - usesMarkWord(text): a mark word ANYWHERE in the text, judged on a folded copy: NFKD; invisible characters
 *   (Default_Ignorable_Code_Point, Cf, the blank braille cell U+2800), control characters (Cc), combining accents (M)
 *   and markdown characters (* _ ` ~) removed; NFKC. A mark word is "built", or "on" and "hold" with nothing between or
 *   up to three non-letters (a space, a dash, a dot, a middle dot), as whole words: "[builtin]", "[builder]",
 *   "rebuilt" and "onholder" are not one. "built-in" IS one (review 6: "[built-done and waiting]" passed for a mark).
 * - quoteOwnWords(text): `"<text>" (the task's own words, not a mark)`, every quote mark inside folded to ' (the set
 *   tasks.forAgent folds for a webhook's words, #1307), so nothing inside can close the quotation.
 *
 * Why the WORD and not the bracket before it: five review rounds of #9179 each found another way to open a mark
 * (lookalike brackets, an emoji or a dash before the word, a closing quote used as an opener). A test on the word
 * itself needs no list of openers.
 * RESIDUAL, stated: lookalike LETTERS (a Cyrillic letter for the b, a dotless i) are not folded, so such a title prints
 * unquoted. The cost, accepted: an ordinary title that uses the word ("the site was built on Friday", "a built-in
 * helper") is printed quoted too; its words are unchanged.
 * Pure: no state, no I/O. #9188 (the task list CLIs and engine/tasklist.js) is meant to call the same two functions.
 */

const cp = (...codes) => codes.map((c) => String.fromCodePoint(c)).join('');
// Removed from the folded copy only (the printed words keep them): invisible, braille blank, control, accents, markdown.
const FOLD_OUT = new RegExp('[\\p{Default_Ignorable_Code_Point}\\p{Cf}' + cp(0x2800) + '\\p{Cc}\\p{M}*_`~]', 'gu');
const MARK_WORD = /(?<![\p{L}\p{N}])(?:on[^\p{L}\p{N}]{0,3}hold|built)(?![\p{L}\p{N}])/iu;
// tasks.forAgent's quote set (#1307): the ASCII double quote, the modifier and prime quotes, and every Pi and Pf mark.
const QUOTES = new RegExp('["' + cp(0x02BA, 0x02EE, 0x2032, 0x2035, 0x05F4, 0x3003, 0x275D, 0x275E) + '\\p{Pi}\\p{Pf}]', 'gu');
const NOTE = " (the task's own words, not a mark)";

function fold(text) {
  return String(text == null ? '' : text).normalize('NFKD').replace(FOLD_OUT, '').normalize('NFKC');
}
function usesMarkWord(text) { return MARK_WORD.test(fold(text)); }
function quoteOwnWords(text) { return '"' + String(text == null ? '' : text).replace(QUOTES, "'") + '"' + NOTE; }

module.exports = { usesMarkWord, quoteOwnWords };
