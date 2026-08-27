'use strict';

/**
 * kosmos#986: the quoted last-words line is off the agent GRID and LIST, and
 * every STATE is still there.
 *
 * 🛑 WHY THIS CARD CAME BACK. It was closed once. The close removed
 * `saidLine()`; the quote Josh could still see is produced by `stateReason()`,
 * a different derivation rendering into the same slot. Josh, walking the build:
 * "Yes, this line is still on the grid and list view of the Agents Tab."
 * ⭐ RIGHT METHOD, WRONG NOUN. So this file pins the SLOT, by call site, rather
 * than the absence of one function's name.
 *
 * What Josh kept, in his words: "The states I really want to see are: is it
 * idle? is it working? does it need me? is there some sort of problem?" So a
 * rate-limited or auth-failed agent must STILL speak on the card, including
 * when it also reported a sentence of its own.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pageFnSource(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page; this test now checks nothing');
  let depth = 0;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(start, k + 1); }
  }
  throw new Error('could not find the end of ' + name);
}

// eslint-disable-next-line no-new-func
const stateReason = new Function([pageFnSource('stateReason'), 'return stateReason;'].join('\n'))();

const REPORTED = { stateReported: true, because: 'Finished responding' };

test('the card and row do NOT show the agent\'s quoted sentence', () => {
  assert.equal(stateReason(REPORTED, { noQuote: true }), '',
    'the quoted last-words line is still on the grid and list; that is the whole card');
});

test('the detail panel DOES still show it', () => {
  /* Josh scoped this to two views. Called with no options, the quote stays. */
  assert.match(stateReason(REPORTED), /Finished responding/);
  assert.match(stateReason(REPORTED), /[“”]/, 'the quotation marks are the "in its own words" mark, not decoration');
});

test('a STATE still speaks on the card, even when a sentence was also reported', () => {
  /* 🔑 THE ARM THAT MAKES THIS MORE THAN A DELETION. The quoted branch returned
     EARLY, so suppressing it by returning '' would have silenced the usage-limit
     and sign-in sentences too -- exactly the "keep every state" half of the card. */
  const limited = { ...REPORTED, state: 'rate_limited', stateConfidence: 'scraped' };
  assert.match(stateReason(limited, { noQuote: true }), /usage limit/i,
    'a rate-limited agent went silent on the card because it had also reported a sentence');
  const auth = { ...REPORTED, state: 'auth_failed', stateConfidence: 'scraped' };
  assert.match(stateReason(auth, { noQuote: true }), /sign-in/i,
    'an agent with a broken sign-in went silent on the card');
});

test('an agent with nothing to say still says nothing', () => {
  assert.equal(stateReason({ state: 'idle' }, { noQuote: true }), '');
  assert.equal(stateReason({ state: 'idle' }), '');
});

test('the two views Josh named ask for it without the quote, and the detail does not', () => {
  /* Pinned by CALL SITE: the derivation being correct is no use if the card
     stops passing the option. */
  const grid = PAGE.match(/<div class="atask">\$\{esc\(taskLine\([^)]*\)\)\}<\/div>/);
  const list = PAGE.match(/<div class="ltask">\$\{esc\(taskLine\([^)]*\)\)\}<\/div>/);
  assert.ok(grid, 'the grid card no longer renders .atask this way; re-derive this test');
  assert.ok(list, 'the list row no longer renders .ltask this way; re-derive this test');
  assert.match(grid[0], /noQuote/, 'the GRID card is asking for the quoted line again');
  assert.match(list[0], /noQuote/, 'the LIST row is asking for the quoted line again');
  assert.match(PAGE, /dtask\.textContent = taskLine\(a\);/,
    'the detail panel stopped showing the agent\'s own words, which this card did not ask for');
});

/**
 * The cell #986 emptied cannot collapse its column, and that is a property of
 * the TEMPLATE rather than of the content.
 *
 * 🛑 WRITTEN BECAUSE MY BROWSER ASSERTION FOR THIS COULD NOT FAIL. I added three
 * lines to `render-list-row.js` claiming they pin that the emptied cell holds
 * its column, then read the CSS: every track is fixed or `minmax(...)` with a
 * floor, so an empty cell could never have collapsed one. The assertions were
 * guarding the template while their header said they guarded the content, and a
 * green would have been read as covering something it never touched.
 * ⭐ SO THE INSTRUMENT MOVED TO MATCH THE CLAIM. The claim is about CSS, CSS is
 * text, and a browser was never needed to check it. This runs in the normal
 * suite on every change instead of behind a rich-fixture board.
 * 📌 #278 is why it matters: a row that supplies fewer cells than its neighbour
 * shifts every later cell one column right, and the agent's ROLE landed in the
 * STATE column reading "Idle / Legal / Idle".
 */
test('every list-row track has a floor, so an empty cell cannot collapse one', () => {
  const rule = PAGE.match(/\.lrow \{[^}]*\}/);
  assert.ok(rule, '.lrow lost its rule; this test now checks nothing');
  const decl = rule[0].match(/grid-template-columns:\s*([^;]+);/);
  assert.ok(decl, '.lrow no longer declares grid-template-columns; re-derive this test');
  /* Split on top-level spaces only: `minmax(6rem, .7fr)` is ONE track and
     contains both a space and a comma. */
  const tracks = [];
  let depth = 0;
  let cur = '';
  for (const ch of decl[1].trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ' ' && depth === 0) { if (cur) tracks.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) tracks.push(cur);

  /* 🔑 THE COUNT IS A COMPARISON, not a number I typed. The not-running row is
     the one #278 broke, so the template is asserted against the cells that row
     actually supplies. Adding a column to one and not the other fails here. */
  const offRow = PAGE.match(/<div class="lrow off notrunning"[\s\S]*?<\/div>\s*`/);
  assert.ok(offRow, 'the not-running row markup moved; re-derive this test');
  /* ⚠️ `[^"]*` AFTER THE FIRST WORD, AND THE FIRST VERSION DID NOT HAVE IT. The
     state cell is `class="lstate ${...}"` -- it carries a second class -- so a
     pattern ending at the first word counted 6 of the 7 cells and failed a
     template that is correct. It failed LOUDLY, which is the only reason this
     comment exists rather than a wrong green.
     The row's own opening tag is sliced off first, or `lrow off notrunning`
     counts as an eighth cell. */
  const inner = offRow[0].slice(offRow[0].indexOf('>') + 1);
  const cells = inner.match(/<div class="l[a-z]+[^"]*"/g) || [];
  assert.equal(tracks.length, cells.length,
    `the template has ${tracks.length} tracks and the row supplies ${cells.length} cells`);

  /* A bare `auto`, `min-content` or `fit-content` track sizes to its CONTENT, so
     an empty cell in one collapses to nothing and everything after it moves. */
  for (const t of tracks) {
    assert.ok(!/^(auto|min-content|fit-content.*)$/.test(t),
      `track "${t}" sizes to its content, so an empty cell would collapse it`);
    assert.ok(/^\d|^minmax\(/.test(t), `track "${t}" has no floor`);
  }
});
