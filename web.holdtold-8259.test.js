'use strict';
/* kosmos#8259: the Tasks row's sentence on whether the agent that held a task for the person has asked them, lifted from
   the page with its one callee (agoWords). Checked in the real page by docs/browser-checks/render-onhold-4771.js.

     node --test web.holdtold-8259.test.js
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scriptOf, liftAll } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const ctx = {};
vm.runInNewContext(liftAll(SCRIPT, ['agoWords', 'tskHoldToldWords']) + '\nthis.f = tskHoldToldWords;', ctx);
const f = ctx.f;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600e3;
const held = (extra) => ({ onHold: true, onHoldForPerson: true, ...extra });

test('not a for-you hold: nothing', () => {
  assert.equal(f({ onHold: true }), '');
  assert.equal(f({ onHoldForPerson: true }), '');
  assert.equal(f(null), '');
});

test('never told: says Kosmos has not seen it ask, as what was seen, not as a fact about the agent', () => {
  assert.equal(f(held()), ' Kosmos has not seen it ask you about this yet.');
});

test('told: when it first asked, and again when it asked since', () => {
  assert.equal(f(held({ onHoldToldAt: iso(2 * H + 60e3) })), ' It asked you 2 hours ago.');
  assert.equal(f(held({ onHoldToldAt: iso(5 * H), onHoldLastToldAt: iso(2 * H + 60e3) })), ' It asked you 5 hours ago, and again 2 hours ago.');
});

test('answered, and not asked again since: says so; asked again after the answer: back to asked', () => {
  assert.equal(f(held({ onHoldToldAt: iso(4 * H), onHoldAnsweredAt: iso(2 * H + 60e3) })),
    ' You answered 2 hours ago (it asked you 4 hours ago), and it is still on hold.');
  assert.equal(f(held({ onHoldToldAt: iso(3 * H), onHoldLastToldAt: iso(10 * 60e3), onHoldAnsweredAt: iso(H) })),
    ' It asked you 3 hours ago, and again 10 minutes ago.');
});

test('round 1 W3: a mark ahead of this clock (a slow phone) still reads as asked, never as not asked', () => {
  assert.equal(f(held({ onHoldToldAt: iso(-90e3) })), ' It asked you.');
  assert.equal(f(held({ onHoldToldAt: iso(-60e3), onHoldAnsweredAt: iso(-90e3) })), ' You answered, and it is still on hold.');
});

test('kosmos#8389: two or more counted asks say how many, first and last', () => {
  const four = f(held({ onHoldToldAt: iso(30 * H), onHoldLastToldAt: iso(2 * H), onHoldToldCount: 4 }));
  assert.match(four, /^ It asked you 4 times, first .+ ago, last .+ ago\.$/);
  const two = f(held({ onHoldToldAt: iso(30 * H), onHoldLastToldAt: iso(2 * H), onHoldToldCount: 2 }));
  assert.match(two, /^ It asked you 2 times, first .+ ago, last .+ ago\.$/, 'the board and the CLI both count from two');
  const none = f(held({ onHoldToldAt: iso(30 * H), onHoldLastToldAt: iso(2 * H) }));
  assert.doesNotMatch(none, /times/, 'CONTROL: an uncounted hold shows no count');
});

/* kosmos#8389 review 4: the board's column card (what most people see; the Tasks tab hides under 25 tasks) says it too,
   not only the Tasks row. The real card is checked painted by docs/browser-checks/render-onhold-4771.js. */
test('kosmos#8389: the board column card carries the same sentence as the Tasks row', () => {
  const at = SCRIPT.indexOf('function paintProjectTasks(');
  assert.ok(at > -1, 'CONTROL: paintProjectTasks is on the page');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('\nfunction ', at + 1));
  const card = body.slice(body.indexOf('tkcard-for-you'), body.indexOf('</span>', body.indexOf('tkcard-for-you')) + 300);
  assert.ok(body.includes('tkcard-for-you'), 'CONTROL: the for-you card is painted there');
  assert.match(card, /esc\(tskHoldToldWords\(t\)\)/, 'the column card says nothing of whether it asked, or how often');
});
