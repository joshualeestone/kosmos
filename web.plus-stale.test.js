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

/* #3796 REVERSES #1012's first half. Every account now has a second step (the coordinator requires
   one), so "I lost my phone" is recovery for a problem every connected person CAN have, and it is
   the only recovery there is; hiding it with no devices left an authenticator-only account with no
   way back (Josh's live test, 2026-09-25). Enrolled is now the only gate (the unenrolled test below). */
test('#3796 (reverses #1012): with no devices, the recovery block IS still offered on an enrolled computer', async () => {
  const w = world(connected([]));
  await paint(w);
  assert.equal(w.el('plus-devempty').hidden, false, 'the "None yet" line should be showing');
  // #4080: the reset is behind "Lost your phone?" in the enrolled-only bottom row (#plus-forget); that row is the gate.
  w.el('plus-forget').hidden = true;   // a stub starts visible; only paintPlus may show it
  await paint(w);
  assert.equal(w.el('plus-forget').hidden, false,
    '"Lost your phone?" is hidden with no devices, so an authenticator-only account has no recovery');
});

test('#1012: once a device exists, the recovery block IS offered', async () => {
  const w = world(connected([{ device_id: 'd1', allowed_at: 1, last_seen: 2 }]));
  await paint(w);
  assert.equal(w.el('plus-devempty').hidden, true);
  w.el('plus-forget').hidden = true;   // #4080: only paintPlus may show the row with "Lost your phone?"
  await paint(w);
  assert.equal(w.el('plus-forget').hidden, false,
    'a person with a phone can no longer reach the reset');
});

test('#1012: it can only hide further, never reveal on an unenrolled Mac', async () => {
  const r = connected([{ device_id: 'd1', allowed_at: 1 }]);
  r.enrolled = false;
  const w = world(r);
  await paint(w);
  /* #1615: paintPlus now gates the whole connected flow on `enrolled`, so an unenrolled Mac
     rests at state 1 with `#plus-flow` (which CONTAINS the reset control) hidden. That is a
     stronger form of the #1012 guarantee than the reset self-hiding: a person with no
     enrolment cannot reach "I lost my phone" whatever their device count, because the flow it
     lives in is not shown at all. Against the pre-change page (gate on `configured`, always
     true) the connected stub keeps the flow open, so this assertion fails there, which keeps
     the test falsifiable. */
  assert.equal(w.el('plus-flow').hidden, true,
    'an unenrolled Mac must show state 1 with the connected flow (and the reset inside it) hidden');
  assert.equal(w.el('plus-state1').hidden, false,
    'an unenrolled Mac must fall back to the state 1 holding place');
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

test('#1014, superseded by #4080: with no phone yet, the address instruction is not shown (the address is off the pane)', async () => {
  /* #4080 (Josh, 22:07: hide the address; 22:22 design): the pane no longer shows the machine's address, and the
     box at the top already says where to go ("Sign in at login.kosmosplus.com." with Open). An instruction naming
     the address would put it back. #1014's point, say what to DO, is now carried by that box. */
  const w = world(connected([]));
  await paint(w);
  assert.equal(w.el('plus-next').hidden, true, 'the address instruction is back on a pane that no longer shows the address');
  assert.doesNotMatch(w.el('plus-next').textContent || '', /installkosmos\.com|kosmosplus\.com/, 'the machine address is named on the pane');
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
