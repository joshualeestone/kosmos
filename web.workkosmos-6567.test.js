'use strict';

/**
 * kosmos#6567 (follow-up from #6565): two page sentences outside plusOrgIn still said "work Kosmos" to a family.
 * - The leave refusal on a member's OTHER computer is a plain server sentence (server.js: "This Kosmos is not your work
 *   Kosmos. Leave from your work Kosmos."). The board there has no record, so it cannot know the kind; the page does
 *   (the joined view that offered Leave), so it says the refusal through plusOrgIn.
 * - The stopped note ("no longer the work Kosmos for X") is written after the record that knew the kind is gone; the
 *   engine now keeps the kind beside the name (stoppedKind) and GET /api/org sends it.
 * plusOrgIn is lifted from the page and called; the wiring is pinned by its source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function slice(start) {
  const at = PAGE.indexOf(start);
  assert.notEqual(at, -1, `${start} is not in the page`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}
// eslint-disable-next-line no-new-func
const plusOrgIn = new Function(slice('function plusOrgIn(') + '\nreturn plusOrgIn;')();

const REFUSAL = 'This Kosmos is not your work Kosmos. Leave from your work Kosmos.';

test('#6567: the server\'s leave refusal is still the sentence this test reads', () => {
  assert.ok(SERVER.includes("because: '" + REFUSAL + "'"), 'server.js changed its leave refusal; update this test to the new sentence');
});

test('#6567: a family reads the leave refusal in its words; a company keeps them', () => {
  assert.equal(plusOrgIn({ kind: 'family' }, REFUSAL), 'This Kosmos is not your family\'s Kosmos. Leave from your family\'s Kosmos.');
  assert.equal(plusOrgIn({ kind: 'company' }, REFUSAL), REFUSAL, 'CONTROL: a company keeps its words');
  assert.equal(plusOrgIn(null, REFUSAL), REFUSAL, 'CONTROL: with no org known, the words are left as they are');
});

test('#6567: the page says a leave refusal through plusOrgIn with the org it left', () => {
  assert.match(PAGE, /: \(r\.because \? plusOrgIn\(org0, r\.because\) : \(r\.error \|\| 'Leaving did not go through\./);
});

test('#6567: the stopped note says "is no longer in" for a family, and the board sends the kind', () => {
  assert.ok(PAGE.includes("(j.stoppedKind === 'family' ? 'This Kosmos is no longer in ' : 'This Kosmos is no longer the work Kosmos for ') + j.stoppedFor"),
    'the stopped note does not branch on the kind');
  assert.match(SERVER, /const stoppedKind = stopped \? oe\.stoppedKind\(\) : null;/);
  // Only beside a stopped note: the reply's shape is unchanged when there is none (server.orgenroll-5531.test.js pins it).
  assert.ok(SERVER.includes('stoppedFor: stopped, ...(stopped ? { stoppedKind } : {}), leaveRefused:'), 'GET /api/org does not send stoppedKind with a stopped note');
});

test('#6567 review 1: a carried stopped note keeps its kind, and a family\'s review refusal is said in its words', () => {
  assert.ok(PAGE.includes("PLUS_ORG.carried = { stoppedFor: j.stoppedFor || null, stoppedKind: j.stoppedKind || null,"), 'a carried note drops its kind');
  assert.ok(PAGE.includes('if (!j.stoppedFor && c.stoppedFor) { j.stoppedFor = c.stoppedFor; j.stoppedKind = c.stoppedKind; }'), 'the carried kind is not restored with the note');
  assert.ok(PAGE.includes("msg.textContent = p.because ? plusOrgIn(PLUS_ORG.state && PLUS_ORG.state.org, p.because) :"), 'the review preview refusal is not said through plusOrgIn');
});
