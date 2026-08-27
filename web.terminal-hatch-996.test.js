'use strict';

/**
 * Josh's rule, guarded rather than merely applied (#996).
 *
 * 🛑 THE LINE THIS PROTECTS HAD NO TEST, WHICH IS WHY IT SURVIVED THREE PASSES.
 * #996 named four places that tell a non-technical person to open a Terminal.
 * Three were resolved and the fourth kept being found again by hand, because
 * nothing failed when it stayed. A rule that lives only in a card gets applied
 * by whoever remembers it.
 *
 * ⭐ THE CLAIM IS ABOUT SHAPE, NOT WORDING. "Terminal" may appear — the
 * connect step's own hatch says "Already use Terminal?" and macOS itself shows
 * a dialog naming tmux, so a page forbidden from the word would have to lie
 * about what a person is looking at. What is forbidden is the word reaching a
 * reader as a STANDING INSTRUCTION: an imperative they did not ask for.
 *
 * 🔑 SO THE TEST ASKS WHERE THE WORD SITS, and the disclosure is the sanctioned
 * home. `.fr-hatch` was created for this card — its own CSS comment says "the
 * advanced escape hatch, quiet by construction. It is an aside for somebody who
 * already has the tool, never a step in the flow."
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** Every `<p class="fhint">…</p>` and `<p class="dhint">…</p>` the page builds. */
function hintParagraphs() {
  return [...PAGE.matchAll(/<p class="(?:fhint|dhint)"[^>]*>([\s\S]{0,400}?)<\/p>/g)].map((m) => m[1]);
}

test('CONTROL: the page yields hint paragraphs and at least one names Terminal somewhere', () => {
  /* An absence assertion over a page we failed to parse passes for the wrong
     reason. Presence first: prove the extractor finds paragraphs at all, and
     prove the word is still present SOMEWHERE, so a page that simply deleted
     every mention cannot pass this file by emptiness. */
  const hints = hintParagraphs();
  assert.ok(hints.length > 20, `only ${hints.length} hint paragraphs found; the extractor is wrong`);
  assert.match(PAGE, /Terminal/, 'the word has vanished entirely; re-derive this test');
});

test('the imperative reaches a reader nowhere on the page', () => {
  /**
   * 🛑 THIS USED TO SCAN ONLY `<p class="fhint|dhint">` LITERALS AND THAT WAS A
   * BLIND SPOT. Most hints on this page are BUILT by string concatenation --
   * `'<p class="dhint">' + x + '</p>'` -- so a literal-paragraph extractor
   * cannot see them, and the miss would have failed toward all-clear: the one
   * direction a guard must never fail in.
   * ⭐ Measured before rewriting rather than after: 130 literal hint paragraphs
   * exist and exactly 3 occurrences of the imperative exist anywhere, so the
   * narrow version passed today and would have gone on passing over a hint
   * assembled from pieces.
   *
   * 🔑 SO THE SCAN IS THE WHOLE PAGE, MINUS THE TWO PLACES THE WORD IS ALLOWED:
   *   - comments, which are addressed to us and not to a reader
   *   - inside a <details> disclosure, which is the sanctioned escape hatch
   * Everything else is a reader-facing imperative, whatever markup carries it.
   */
  const IMPERATIVE = /open (?:a |the )?Terminal/i;
  let text = PAGE
    .replace(/<!--[\s\S]*?-->/g, ' ')          // HTML comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // block comments in the script
    .replace(/<details[\s\S]*?<\/details>/g, ' '); // the sanctioned disclosures
  /* ⚠️ The disclosures are BUILT as concatenated strings too, so strip that
     shape as well or the connect step's own hatch reads as an offender. */
  text = text.replace(/'<details[\s\S]{0,600}?<\/details>'/g, ' ');

  const hit = text.match(IMPERATIVE);
  assert.equal(hit, null,
    'the page tells a reader to open a Terminal outside a disclosure: '
    + (hit ? JSON.stringify(text.slice(Math.max(0, hit.index - 90), hit.index + 60)) : ''));
});

test('the board-failure escape hatch is a disclosure, and it still exists', () => {
  /* 🛑 BOTH HALVES, BECAUSE DELETING THE LINE WOULD ALSO PASS THE TEST ABOVE.
     #274: the moment a person most needs to look for themselves is the moment
     `tmux ls` says "command not found", since Kosmos ships its own tmux off
     PATH. The escape must survive; only the instruction goes.

     ⚠️ ANCHORED ON THE SENTENCE, NOT ON `boardfail`. The first version sliced
     from `PAGE.indexOf('boardfail')`, which lands on the CSS RULE 10,000 lines
     earlier, so the slice was 652,184 characters -- effectively the whole page.
     It asserted that a hatch exists SOMEWHERE, which was true and meaningless,
     and it would have stayed green while this block lost its escape entirely.
     ⭐ A TRUE QUESTION ABOUT THE WRONG SCOPE. Caught by printing the slice
     length instead of trusting a passing assertion. */
  const start = PAGE.indexOf('We cannot read your agents right now.');
  assert.ok(start > -1, 'the board-failure block moved; re-derive this test');
  const end = PAGE.indexOf('data-board-retry', start);
  assert.ok(end > start, 'the retry button left this block; re-derive this test');
  const board = PAGE.slice(start, end + 60);
  assert.ok(board.length < 4000,
    `the slice is ${board.length} characters, so it is not this block any more`);
  assert.match(board, /kosmos agents/, 'the escape hatch is gone: nobody can look for themselves any more');
  assert.match(board, /<details class="fr-hatch"><summary>[^<]*Terminal/,
    'the escape is no longer behind a disclosure, so it reads as an instruction again');
});
