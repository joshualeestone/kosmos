'use strict';
/**
 * kosmos#6385. A computer joining Kosmos+ waits its turn: the computer that allows answers one new computer at a time,
 * about one every 10 minutes (the tunnel's ANSWER_EVERY_SECS), and the joining computer is not told. Adding computers
 * 3 and 4 in one sitting read as stuck for 10 to 20 minutes. After a minute with no code, the joiner's block now says
 * why that can take a while, both while it works out the first code and after a Try again.
 *
 * The real paintPlusJoin and its helpers, lifted from the page and run against a stand-in element and a clock the test
 * moves, so the minute is measured, not waited for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function slice(start) {
  const at = PAGE.indexOf(start);
  assert.notEqual(at, -1, `${start} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}
/* The page's own declarations of the join state, so the test runs with the page's starting values and minute. */
function varsBlock() {
  const a = PAGE.indexOf('var PLUS_JOIN = null;');   // from PLUS_JOIN itself, so no rig leaks it onto the global object
  const b = PAGE.indexOf('var PLUS_JOIN_WAITED = false;');
  assert.ok(a > 0 && b > a, 'the join state declarations moved');
  return PAGE.slice(a, PAGE.indexOf('\n', b));
}

function rig() {
  const clock = { now: 1_000_000 };
  const el = { hidden: false, innerHTML: '', contains: () => false };
  const document = {
    getElementById: (id) => (id === 'plus-join' ? el : null),
    activeElement: null,
  };
  const FakeDate = { now: () => clock.now };
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'Date', varsBlock() + '\n'
    + ['function askEsc(', 'function plusJoinPillWord(', 'function plusJoinLive(', 'function plusJoinSpoken(',
      'function plusJoinCode(', 'function plusJoinSlowLine(', 'function paintPlusJoin('].map(slice).join('\n')
    + `
return {
  set(j) { PLUS_JOIN = j; PLUS_JOIN_WAITING = true; },
  retried(at) { PLUS_JOIN_RETRY_AT = at; },
  paint: paintPlusJoin,
  reset() { PLUS_JOIN = null; PLUS_JOIN_WAITING = false; },
  slowMs: () => PLUS_JOIN_SLOW_MS,
};`);
  const api = make(document, FakeDate);
  return { api, el, clock };
}
const SLOW = /one computer at a time, about one every 10 minutes/;
const HELD = { supported: true, held: true, on: 'Studio Mac' };

test('#6385: the minute is the page\'s own (PLUS_JOIN_SLOW_MS), and it is a minute', () => {
  const r = rig();
  assert.equal(r.api.slowMs(), 60 * 1000);
});

test('#6385: each rig has its own pairing (nothing leaks onto the global object)', () => {
  const r = rig();
  r.api.set({ ...HELD });
  assert.equal(typeof globalThis.PLUS_JOIN, 'undefined', 'the rig set a global PLUS_JOIN');
  const fresh = rig();
  fresh.api.paint();
  assert.equal(fresh.el.innerHTML, '', 'a fresh rig painted the last rig\'s pairing');
});

test('#6385: working out the first code, the joiner says why it can take a while after a minute, not before', () => {
  const r = rig();
  r.api.set({ ...HELD });
  r.api.paint();
  assert.match(r.el.innerHTML, /Working out the code with Studio Mac/, 'CONTROL: this is the wait the card is about');
  assert.doesNotMatch(r.el.innerHTML, SLOW, 'the line shows at once, before anything is slow');
  r.clock.now += 59 * 1000;
  r.api.paint();
  assert.doesNotMatch(r.el.innerHTML, SLOW, 'the line shows before a minute');
  r.clock.now += 2 * 1000;
  r.api.paint();
  assert.match(r.el.innerHTML, SLOW, 'after a minute with no code the joiner still does not say why it waits');
  assert.match(r.el.innerHTML, /Keep this open: the code shows here\./);
});

test('#6385: after a Try again, "a new one is on its way" says the same after a minute', () => {
  const r = rig();
  r.api.set({ ...HELD, confirm_expired: true });
  r.api.retried(r.clock.now);
  r.api.paint();
  assert.match(r.el.innerHTML, /A new one is on its way/, 'CONTROL: this is the after-Try-again wait');
  assert.doesNotMatch(r.el.innerHTML, SLOW);
  r.clock.now += 61 * 1000;
  r.api.paint();
  assert.match(r.el.innerHTML, SLOW, 'the after-Try-again wait does not say why it waits');
});

test('#6385: once a code shows the line goes, and the next wait starts its own minute', () => {
  const r = rig();
  r.api.set({ ...HELD });
  r.api.paint();
  r.clock.now += 61 * 1000;
  r.api.paint();
  assert.match(r.el.innerHTML, SLOW, 'CONTROL: the line was showing');
  r.api.set({ ...HELD, join_code: '123 456' });
  r.api.paint();
  assert.doesNotMatch(r.el.innerHTML, SLOW, 'the line stays beside a code that has arrived');
  assert.match(r.el.innerHTML, /123 456/);
  // The code is withdrawn (a new round): the minute starts again, not from the first wait.
  r.api.set({ ...HELD });
  r.api.paint();
  assert.doesNotMatch(r.el.innerHTML, SLOW, 'a new wait reused the old wait\'s start');
});

test('#6385: a pairing that ends clears the wait, so a later one starts its own minute', () => {
  const r = rig();
  r.api.set({ ...HELD });
  r.api.paint();
  r.clock.now += 61 * 1000;
  r.api.reset();
  r.api.paint();
  assert.equal(r.el.innerHTML, '', 'CONTROL: nothing shows with no pairing');
  r.api.set({ ...HELD });
  r.api.paint();
  assert.doesNotMatch(r.el.innerHTML, SLOW, 'a fresh pairing showed the line at once');
});
