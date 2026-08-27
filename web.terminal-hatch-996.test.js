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

test('no hint paragraph tells a person to open a Terminal', () => {
  /**
   * ⚠️ THE PATTERN IS THE IMPERATIVE, not the noun. "open Terminal" and "open
   * a Terminal" are instructions; "Already use Terminal?" is a question, and
   * "a box asking about tmux" describes what macOS is showing them.
   */
  const offenders = hintParagraphs().filter((t) => /\bopen (?:a |the )?Terminal\b/i.test(t));
  assert.deepEqual(offenders, [],
    'a hint paragraph instructs a person to open a Terminal:\n  ' + offenders.join('\n  '));
});

test('the board-failure escape hatch is a disclosure, and it still exists', () => {
  /* 🛑 BOTH HALVES, BECAUSE DELETING THE LINE WOULD ALSO PASS THE TEST ABOVE.
     #274: the moment a person most needs to look for themselves is the moment
     `tmux ls` says "command not found", since Kosmos ships its own tmux off
     PATH. The escape must survive; only the instruction goes. */
  const board = PAGE.slice(PAGE.indexOf('boardfail'), PAGE.indexOf('data-board-retry') + 200);
  assert.ok(board.length > 200, 'the board-failure block moved; re-derive this test');
  assert.match(board, /kosmos agents/, 'the escape hatch is gone: nobody can look for themselves any more');
  assert.match(board, /<details class="fr-hatch"><summary>[^<]*Terminal/,
    'the escape is no longer behind a disclosure, so it reads as an instruction again');
});
