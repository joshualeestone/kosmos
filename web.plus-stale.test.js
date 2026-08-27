'use strict';
/**
 * kosmos#1011 and #1012, both in Settings > Plus Account, and both the same
 * shape: two lines computed at different moments and never reconciled, so
 * the screen says two things at once and the wrong one catches the eye.
 *
 *   #1011  "Connected. Your address: ..." with "the coordinator said no
 *          (409)" still sitting under it, left over from a previous attempt.
 *   #1012  "I lost my phone" and Reset the second step offered directly
 *          under a device list reading "None yet".
 *
 *   node --test web.plus-stale.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

// paintPlus calls paintDevices() WITHOUT awaiting it, so a bare
// `await paintPlus()` returns while the device repaint is still in flight.
// Every assertion below is about what paintDevices decides, so they have to
// wait for it. Getting this wrong cost me two "failures" that were my test
// racing the code rather than the code being wrong.
const settle = () => new Promise((r) => setTimeout(r, 0));
const paint = async (w) => { await w.ctx.paintPlus(); await settle(); await settle(); };

// Anchored on the declaration deliberately hoisted above both paint
// functions, through the end of the switch handler that tags its own
// failures. If either anchor moves the slice is wrong, so it asserts.
function world(remote) {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, textContent: '', innerHTML: '', hidden: false, disabled: false,
    listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; },
  });
  const ctx = {
    document: { getElementById: el },
    fetch: async () => ({ ok: true, json: async () => remote }),
    plusWords: (s) => s,
    askKind: () => 'a phone', askEsc: (s) => String(s), askAgo: () => 'today',
    ASK: { confirm: null, pending: [], done: {} },
    paintAsk: () => {}, plusSecondDisarm: () => {}, pollAsk: () => {},
    plusCountdown: () => {}, PLUS_COUNTDOWN: null, PLUS_CODE_WORDS: {},
    PLUS_EPOCH: 0, console,
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
  };
  // Start at the #1011 block when it is there, and at paintDevices when it
  // is not, so this same file can be pointed at the PRE-CHANGE page (via
  // PLUS_PAGE=) and show these assertions actually failing. A test that has
  // never been seen to fail is not evidence of anything.
  let start = SCRIPT.indexOf('/* #1011. The panel showed');
  if (start < 0) start = SCRIPT.indexOf('async function paintDevices(');
  const end = SCRIPT.indexOf('/* The words of the code box');
  assert.ok(start > 0 && end > start, 'the plus panel script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { ctx, el };
}

const connected = (allowed) => ({
  configured: true, on: true, enrolled: true,
  status: { state: 'up', address: 'josh.plus.installkosmos.com' },
  allowed: allowed || [], pending: [],
});

test('#1012: with no devices, the recovery block is NOT offered', async () => {
  const w = world(connected([]));
  await paint(w);
  assert.equal(w.el('plus-devempty').hidden, false, 'the "None yet" line should be showing');
  assert.equal(w.el('plus-second').hidden, true,
    '"I lost my phone" was offered to somebody who has never had a phone on the account');
});

test('#1012: once a device exists, the recovery block IS offered', async () => {
  const w = world(connected([{ device_id: 'd1', allowed_at: 1, last_seen: 2 }]));
  await paint(w);
  assert.equal(w.el('plus-devempty').hidden, true);
  assert.equal(w.el('plus-second').hidden, false,
    'a person with a phone can no longer reach the reset');
});

test('#1012: it can only hide further, never reveal on an unenrolled Mac', async () => {
  const r = connected([{ device_id: 'd1', allowed_at: 1 }]);
  r.enrolled = false;
  const w = world(r);
  await paint(w);
  assert.equal(w.el('plus-second').hidden, true,
    'an unenrolled Mac cannot sign the reset, so the control must stay hidden whatever the device count');
});

test('#1011: being connected clears a stale SETUP failure', async () => {
  const w = world(connected([]));
  w.ctx.plusSay('the coordinator said no (409): that name is already in use', 'setup');
  assert.equal(w.el('plus-msg').textContent.length > 0, true, 'precondition: the error is on screen');
  await paint(w);
  assert.equal(w.el('plus-msg').textContent, '',
    'the panel said Connected and "the coordinator said no" at the same time');
});

test('#1011: but a SWITCH failure is left alone, because those happen while connected', async () => {
  const w = world(connected([]));
  w.ctx.plusSay('we could not change that', 'switch');
  await paint(w);
  assert.equal(w.el('plus-msg').textContent, 'we could not change that',
    'a real refusal to turn Plus off was wiped by the next repaint');
});

test('#1011: a setup failure survives while NOT connected, which is when it is true', async () => {
  const r = connected([]);
  r.status = { state: 'down', because: 'starting the connection' };
  const w = world(r);
  w.ctx.plusSay('we could not finish the sign-up', 'setup');
  await paint(w);
  assert.equal(w.el('plus-msg').textContent, 'we could not finish the sign-up',
    'the error vanished while it was still the truth');
});

test('#1011: clearing the message clears its kind, so a later switch error is not eaten', async () => {
  const w = world(connected([]));
  w.ctx.plusSay('a setup failure', 'setup');
  w.ctx.plusSay('');                      // the next action starts, clearing it
  w.ctx.plusSay('we could not change that', 'switch');
  await paint(w);
  assert.equal(w.el('plus-msg').textContent, 'we could not change that',
    'the cleared setup kind lingered and ate a later switch error');
});

// ---------------------------------------------------------------------------
// kosmos#1014. Setup ended by handing you a URL and stopping. Josh, with a
// working install in front of him: "When am I just supposed to go to my device
// and go to josh.plus.installkosmos.com?"
// ---------------------------------------------------------------------------

test('#1014: a connected Mac with no phone yet is told what to DO, not just what is true', async () => {
  const w = world(connected([]));
  await paint(w);
  const t = w.el('plus-next').textContent;
  assert.equal(w.el('plus-next').hidden, false, 'setup finished and said nothing about what to do next');
  assert.match(t, /josh\.plus\.installkosmos\.com/, 'the instruction does not name the address');
  assert.match(t, /sign in/i, 'it does not warn that a sign-in is coming, which reads as a rebuff when it arrives');
  assert.match(t, /allow/i, 'it does not say this Mac will ask them something next');
});

test('#1014: once a phone is allowed the instruction goes away', async () => {
  const w = world(connected([{ device_id: 'd1', allowed_at: 1 }]));
  await paint(w);
  assert.equal(w.el('plus-next').hidden, true,
    'it kept telling somebody to do a thing they had plainly already done');
});

test('#1014: while the tunnel is still coming up, it says nothing at all', async () => {
  const r = connected([]);
  r.status = { state: 'down', because: 'starting the connection' };
  const w = world(r);
  await paint(w);
  assert.equal(w.el('plus-next').hidden, true, 'told them to open an address that does not exist yet');
});

test('#1014: connected with no address yet is not an instruction to open "is on its way."', async () => {
  const r = connected([]);
  r.status = { state: 'up' };            // up, but no address in hand
  const w = world(r);
  await paint(w);
  assert.equal(w.el('plus-next').hidden, true, 'it would have told them to open a sentence');
});
