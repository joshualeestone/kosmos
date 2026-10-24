'use strict';

/**
 * The detail panel's quoted evidence is ATTRIBUTED.
 *
 * 🛑 THIS SURFACE WAS SWITCHED ON BY ACCIDENT. `<blockquote id="d-said">` shared
 * its id with a span that won every `getElementById`, so it had never rendered
 * once. Removing that span (kosmos#986) freed it -- and what it carries is
 * scraped pane text that can read
 * "Run /usage-credits to continue or switch models with /model".
 *
 * ⚠️ A TERMINAL COMMAND RENDERED BARE IS AN INSTRUCTION TO THE READER. The
 * source comment always said this was "what the screen SAID, not what we
 * concluded" -- but that lived only in the source. On screen it was an
 * unlabelled block, so the vendor's remedy read as Kosmos asking a person to
 * run something they have no terminal for.
 *
 * The sentence is NOT reworded: it names the model, carries the vendor's own
 * remedies, and stays true if their wording changes. Only the attribution is
 * added.
 *
 *   node --test web.said-attrib.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the quote carries a visible attribution', () => {
  /* #6716: the attribution is now the summary of a closed fold around the quote. */
  assert.match(PAGE, /<details class="detail-saidbox" id="d-said-box" hidden>\s*<summary class="detail-saidlab" id="d-said-lab" hidden><\/summary>\s*<blockquote class="detail-said" id="d-said" hidden><\/blockquote>\s*<\/details>/,
    'the attribution line is gone, so scraped pane text renders bare and a slash command in it reads as an instruction');
  /* #3958: the label is computed into `lab` and written only when it changes (the painter runs
     every poll, and an identical rewrite drops a selection). */
  assert.match(PAGE, /const lab = line \? 'What ' \+ a\.name \+ '\\u2019s screen said' : '';\n\s*(?:\/\*[\s\S]*?\*\/\n\s*)?if \(saidLab\.textContent !== lab\) saidLab\.textContent = lab;/,
    'the attribution no longer names the agent, or no longer uses a.name');
});

/* The label must appear and disappear with the quote. A stranded
   "What X's screen said" over nothing is worse than no label at all. */
test('the label follows the quote exactly', () => {
  const i = PAGE.indexOf("const said = document.getElementById('d-said');");
  assert.ok(i > -1, 'the evidence painter moved; re-anchor');
  // Up to the next section's marker, not a character count: a count went stale each time a comment grew (#6716 review 7).
  const end = PAGE.indexOf('/* kosmos#1918: the reachable remedy', i);
  assert.ok(end > i, 'the next section marker moved; re-anchor');
  const block = PAGE.slice(i, end);
  assert.match(block, /said\.hidden = !line;/, 'the quote no longer hides when empty');
  // #6716: the fold around the label and quote is what a person sees hide, so it must follow the quote too.
  assert.match(block, /saidBox\.hidden = !line;/, 'the screen-line fold does not hide with the quote');
  assert.match(block, /saidLab\.hidden = !line;/,
    'the label does not hide with the quote, so an agent with no evidence keeps a stranded heading');
});

/* 🔑 THE IDENTIFIER CONTROL. My first version called `dispName(a)`, which does
   not exist anywhere in this file -- it would have thrown the moment a
   rate-limited agent's page opened, and every text-matching test passed over it
   because a regex cannot call a function. This asserts the helper it uses is
   real, and fails if someone swaps in another invented one. */
test('the painter calls nothing that does not exist', () => {
  const i = PAGE.indexOf('const lab = line ?');
  assert.ok(i > -1, 'the attribution line moved; re-anchor (else this test checks nothing)');
  const line = PAGE.slice(i, PAGE.indexOf('\n', i));
  assert.match(line, /a\.name/, 'anchored on the wrong line');
  const calls = [...line.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  for (const fn of calls) {
    const declared = new RegExp('function\\s+' + fn + '\\b|const\\s+' + fn + '\\s*=').test(PAGE);
    assert.ok(declared, `the attribution line calls ${fn}(), which is not declared anywhere in this file`);
  }
});
