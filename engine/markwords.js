'use strict';
/**
 * kosmos#9179: whether a task's own words could pass for one of the board's marks, and the quoted form that cannot.
 *
 * In an agent's "Your projects" (projects.blockBody), a task line is `  - task N of P: <words><marks>`. A title such as
 * "pay it [built: done and waiting]" on OPEN work would talk the agent out of the task, and one ending "[on hold: ...]"
 * would be read by holdsOf (which reads a hold as the line's LAST mark) as a hold. So a title that uses a mark word at
 * all is printed QUOTED, said to be the task's own words, so its words never end the line in a forged mark (a task
 * really held or built ends in its real mark, after the note).
 *
 * - usesMarkWord(text): a mark word ANYWHERE in the text, judged on a folded copy: NFKD; invisible characters
 *   (Default_Ignorable_Code_Point, Cf, the blank braille cell U+2800), control characters (Cc), combining accents (M)
 *   and markdown characters (* _ ` ~) removed; NFKC. A mark word is "built", or "on" and "hold" with nothing between or
 *   up to six characters that are neither letters nor digits (spaces, dashes, dots, a middle dot), as whole words: "[builtin]", "[builder]",
 *   "rebuilt" and "onholder" are not one. "built-in" IS one (review 6: "[built-done and waiting]" passed for a mark).
 * - quoteOwnWords(text): `"<text>" (the task's own words, not a mark)`, every quote mark inside folded to ': a character
 *   is one when its NFKC form is in tasks.forAgent's quote set (#1307: so the fullwidth double quote counts, as forAgent's
 *   NFKC makes it), or it is one of the CJK double prime quotes U+301D to U+301F (Ps and Pe, which forAgent turns into
 *   round brackets). Only those characters change, so nothing inside can close the quotation.
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
const MARK_WORD = /(?<![\p{L}\p{N}])(?:on[^\p{L}\p{N}]{0,6}hold|built)(?![\p{L}\p{N}])/iu;
// tasks.forAgent's quote set (#1307): the ASCII double quote, the modifier and prime quotes, and every Pi and Pf mark.
const QUOTES = new RegExp('["' + cp(0x02BA, 0x02EE, 0x2032, 0x2035, 0x05F4, 0x3003, 0x275D, 0x275E) + '\\p{Pi}\\p{Pf}]', 'u');
const CJK_QUOTES = new RegExp('[' + cp(0x301D, 0x301E, 0x301F) + ']', 'u');
const isQuote = (c) => CJK_QUOTES.test(c) || QUOTES.test(c.normalize('NFKC'));
const NOTE = " (the task's own words, not a mark)";

function fold(text) {
  return String(text == null ? '' : text).normalize('NFKD').replace(FOLD_OUT, '').normalize('NFKC');
}
function usesMarkWord(text) { return MARK_WORD.test(fold(text)); }
function quoteOwnWords(text) { return '"' + String(text == null ? '' : text).replace(/./gsu, (c) => (isQuote(c) ? "'" : c)) + '"' + NOTE; }

/* kosmos#9188: the task LIST prints more marks than an agent's instructions do (install/kosmos and the Windows CLI
   taskList, engine/tasklist.js): before the words "[done]", "[not run]", "[replaced by N]", "[on hold ...]",
   "[built ...]", "[project paused]"; after them "[added by X]", "[n/m subtasks done ...]", "[repeats ...]",
   "[waits for ...]", "[waits until ...]" or "[woke: ...]", "[m of n checks reported met]"; and a webhook's
   "[outside text from webhook ...]"; and the marks in parentheses listed at LIST_PHRASES.
   usesListMarkWord(text): usesMarkWord, or one of those marks' words, judged on the same folded copy, as whole words
   with the same gap rule between two words. "done" alone is the one common word: it is a mark only where the list
   prints "[done]", at the start of the row, so it counts only as the title's FIRST word (after anything that is not a
   letter); "subtasks done" is caught by "subtasks". The cost, as usesMarkWord's: a title that uses
   one of these words ("repeats the check", "added by hand") prints quoted, its words unchanged. */
const GAP = '[^\\p{L}\\p{N}]{0,6}';
/* Review 1: "waits" alone (a wake prints "waits for ..." OR "waits until ...", and the compact list "(waits on ...)"), and
   the compact, across and long lists' marks in parentheses whose words are fixed: "(through #N)", "(under task N)",
   "(owner: ...)", "(reported finished: ...)", "(still to finish: ...)", "(last activity ...)", "(quiet N days",
   ", left under closed task #N"; review 2: "(no activity on record)", "(next run ...)", "(its project is paused)",
   "(held by the person)", "(only the person can lift it)", "(its hold's condition is met)". ("(... since built)" and
   "(marked built ...)" are caught by "built".) Review 2 narrowed three to the printers' exact words ("subtasks done",
   "woke:", "left under closed"), so "fix subtasks rendering" or "woke up bug" stay plain. An owner's bare
   name in parentheses, "(otto)", has no fixed word to test: kosmos#9201 tests the title's last character instead (below). */
const phrase = (...words) => words.join(GAP);
const LIST_PHRASES = [phrase('not', 'run'), phrase('replaced', 'by'), phrase('project', 'paused'), phrase('project', 'is', 'paused'),
  phrase('added', 'by'), phrase('subtasks', 'done'), 'repeats', 'waits', 'woke\\s*:', phrase('checks', 'reported'), phrase('outside', 'text'),
  // Review 3: "through task N" too (the long list's "(owner: X, through task N)").
  'through\\s*(?:#|task)\\s*#?\\s*\\d+', phrase('under', 'task'), 'owner\\s*:', phrase('reported', 'finished'), phrase('still', 'to', 'finish'),
  phrase('last', 'activity'), 'quiet\\s*\\d+', phrase('left', 'under', 'closed'),
  // Review 2: the compact and across lists' other words in parentheses.
  phrase('no', 'activity', 'on', 'record'), phrase('next', 'run'), phrase('held', 'by', 'the', 'person'),
  phrase('only', 'the', 'person', 'can', 'lift'), phrase('condition', 'is', 'met'),
  // Review 3: the built mark's words ("[built, waiting on a review]", "the person", "a release"), "(seen by the person",
  // and a hold's "until task N is closed".
  phrase('waiting', 'on', '(?:a|the)', '(?:review|person|release)'), phrase('seen', 'by', 'the', 'person'),
  phrase('until', 'task') + '\\s*#?\\s*\\d+'];
// Review 3: "done" in brackets or parentheses ANYWHERE ("release notes [done]", "fix login (done)"), as the list prints it;
// a bare "done" still counts only as the first word.
const BRACKET_DONE = /[[(]\s*done\s*[\])]/iu;
const LIST_WORD = new RegExp('(?<![\\p{L}\\p{N}])(?:' + LIST_PHRASES.join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
// Review 1: also after a number written as a row's own label, "[7] [done] x" or "#3 [done] x" (a bracket or # before the
// digits, so "3 done items" stays plain).
const FIRST_DONE = /^[^\p{L}\p{N}]*(?:[[(#]\s*\d+\s*[\])]?[^\p{L}\p{N}]*)?done(?![\p{L}\p{N}])/iu;
/* kosmos#9201: both long lists print a task's owner right after its words as " (name)", and an unowned task prints
   nothing there, so an unowned task titled "fix the login (otto)" printed exactly as one otto holds. A bare name has no
   fixed word to test, so the test is the title's END: a title (on the folded copy, so a fullwidth bracket counts) whose
   last bracket of ANY kind is followed by nothing but characters that are not letters or digits is printed quoted.
   Any bracket and not only ")": "(otto]" or a nested "(a (otto))" read the same. Opening brackets too (review 1:
   U+FD3F reads as a right parenthesis and is Ps). And not only the last character (review 1): a private-use or other
   blank-looking character the fold keeps, or a "." after the name, would otherwise hide the bracket.
   The cost, stated: an ordinary title ending in brackets ("fix the build (again)", "call foo()") prints quoted, its
   words unchanged. */
const ENDS_IN_BRACKET = /[\p{Ps}\p{Pe}][^\p{L}\p{N}]*$/u;
function usesListMarkWord(text) {
  const f = fold(text);
  return MARK_WORD.test(f) || LIST_WORD.test(f) || FIRST_DONE.test(f) || BRACKET_DONE.test(f) || ENDS_IN_BRACKET.test(f.trim());
}

module.exports = { usesMarkWord, quoteOwnWords, usesListMarkWord };
