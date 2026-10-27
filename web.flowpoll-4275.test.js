'use strict';

/**
 * kosmos#4275: a Claude sign-in start that answers with a phase that has ALREADY ENDED
 * (stuck, interrupted, idle) must not leave the 1s /api/connect poll running.
 *
 *   node --test web.flowpoll-4275.test.js
 *
 * The defect: acctAddStart painted the answer (the ended branch stops the timer), then
 * always started the watch. Every later poll read the same phase and reason and returned
 * at acctFlowPaint's dedup check before it reached acctFlowStop, so the page polled once
 * a second until some later flow ended differently.
 *
 * These RUN the page's own acctAddStart, acctFlowPaint, acctFlowWatch and acctFlowStop
 * against a stub DOM, a fake fetch and a fake interval, and count the polls.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(require('node:path').join(__dirname, 'web', 'index.html'), 'utf8'));

function el(id) {
  return {
    id, textContent: '', innerHTML: '', hidden: false, disabled: false, value: 'claude', attrs: {},
    classList: { add() {}, remove() {} },
    focus() {}, setAttribute(k, v) { this.attrs[k] = v; },
    contains() { return false; }, getClientRects() { return [1]; },
    parentElement: null,
  };
}

/**
 * The page's flow functions sharing one scope, as they do in the page, with the
 * interval and fetch faked. `connect` is what GET /api/connect answers; `start` is
 * what POST /api/connect/start answers.
 */
function harness({ start, connect, cloud = false }) {
  const els = new Map();
  const document = {
    activeElement: null,
    getElementById(id) { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
  };
  const timers = new Map();
  let nextId = 1;
  const polls = { n: 0 };
  const fetch = async (url) => {
    if (url === '/api/connect/start') return { ok: true, json: async () => start };
    if (url === '/api/connect') { polls.n += 1; return { ok: true, json: async () => connect }; }
    throw new Error('unexpected fetch ' + url);
  };
  const setInterval = (fn) => { const id = nextId++; timers.set(id, fn); return id; };
  const clearInterval = (id) => { timers.delete(id); };
  const src = [
    'let ACCT_FLOW_TIMER = null; let ACCT_FLOW_LAST = null; const ACCT_REAUTH_DIR = null;',
    // #3939 slice 3c-2: acctFlowPaint's flow-ended point also clears the Meta Muse "under way" line.
    "const MUSE_BUSY = 'busy'; const acctAddPickSay = () => {};",
    lift(SCRIPT, 'frConnActive'), lift(SCRIPT, 'acctFlowStop'), lift(SCRIPT, 'acctFocusAfterFlow'),
    // kosmos#4903 S5: the page's cloud-machine reader, stubbed; absent unless asked (the page then keeps the Mac words).
    cloud ? 'function onCloudMachine() { return true; }\n' + SCRIPT.match(/const CLOUD_SIGNIN_SAY = \{[^}]*\};/)[0] + '\n' + lift(SCRIPT, 'signinSay') + '\n' + lift(SCRIPT, 'frCloudSigninDetail') : '',
    lift(SCRIPT, 'acctClaudePaintUrl'),
    lift(SCRIPT, 'acctFlowPaint'), lift(SCRIPT, 'acctFlowWatch'), lift(SCRIPT, 'acctAddStart'),
    'return { acctAddStart, acctFlowWatch, acctFlowPaint };',
  ].join('\n');
  const page = new Function(
    'document', 'fetch', 'setInterval', 'clearInterval', 'ACCT_FLOW_SAY', 'acctPick', 'acctClaudeShowSub',
    'paintAccounts', 'acctShowSuccess', 'pjSentence', 'frClaudeConfirmSentence', src,
  )(document, fetch, setInterval, clearInterval, {}, () => {}, () => {}, () => {}, () => {}, (s) => s, () => '');
  /** Fire every live interval once, as a second passing would, and let its fetch settle. */
  async function tick() {
    for (const fn of [...timers.values()]) await fn();
  }
  return { page, timers, polls, tick, document };
}

for (const phase of ['stuck', 'interrupted', 'idle']) {
  test(`#4275: a start answering "${phase}" leaves no poll running`, async () => {
    const answer = { phase, because: phase === 'stuck' ? 'It stopped answering.' : undefined };
    const h = harness({ start: answer, connect: answer });
    await h.page.acctAddStart(true);
    // Zero, not "at most one": the dedup guard below would stop a stray watch after one
    // poll, so only zero pins the start's own guard (an ended flow has nothing to watch).
    assert.equal(h.timers.size, 0, 'an ended start began the poll');
    for (let i = 0; i < 5; i++) await h.tick();
    assert.equal(h.polls.n, 0, `polled ${h.polls.n} times after an ended start`);
  });
}

test('#4275 control: a start answering an ACTIVE phase keeps polling until the flow ends', async () => {
  const connect = { phase: 'signin-browser-open' };
  const h = harness({ start: { phase: 'signin-launching' }, connect });
  await h.page.acctAddStart(true);
  for (let i = 0; i < 3; i++) await h.tick();
  assert.equal(h.timers.size, 1, 'an active sign-in lost its poll, so it can never show its outcome');
  assert.equal(h.polls.n, 3, 'the active flow was not polled once per tick');
  connect.phase = 'connected';
  await h.tick();
  assert.equal(h.timers.size, 0, 'the poll kept running after the flow connected');
});

test('#4275: a watch started over an already-painted ENDED phase stops on its first poll', async () => {
  // Any watch, not only the start's (the code and cancel handlers start one too): the dedup
  // check must not hide an ending.
  const ended = { phase: 'interrupted' };
  const h = harness({ start: ended, connect: ended });
  h.page.acctFlowPaint(ended);
  h.page.acctFlowWatch();
  assert.equal(h.timers.size, 1);
  await h.tick();
  await h.tick();
  assert.equal(h.timers.size, 0, 'a repeated ended phase did not stop the poll');
  assert.equal(h.polls.n, 1);
});

test('#4275: the code and cancel handlers reset the dedup key AND make sure a poll runs to read it', () => {
  // Resetting ACCT_FLOW_LAST only helps if something polls; they must not rely on the start having left one running.
  for (const id of ['acct-code-go', 'acct-cancel']) {
    const at = SCRIPT.indexOf(`getElementById('${id}').addEventListener`);
    assert.ok(at > -1, `the ${id} handler moved; restate this pin`);
    const end = SCRIPT.indexOf('\n});', at);
    // Code only: a call named in a comment must not satisfy this.
    const handler = SCRIPT.slice(at, end).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.match(handler, /ACCT_FLOW_LAST = null;[\s\S]*^\s*acctFlowWatch\(\);/m, `the ${id} handler resets the key without making sure a poll runs`);
  }
});

test('kosmos#4903 S5: Settings\' Claude sign-in on a cloud machine shows the sign-in page\'s link, and says to open it', () => {
  const URL = 'https://claude.com/cai/oauth/authorize?code=true';
  const h = harness({ start: {}, connect: {}, cloud: true });
  h.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: URL });
  const row = h.document.getElementById('acct-claude-open-row');
  assert.equal(row.hidden, false, 'a cloud machine got no link: nothing opens a browser there');
  assert.equal(h.document.getElementById('acct-claude-open').href, URL);
  assert.match(h.document.getElementById('acct-flow-say').textContent, /Open the Claude sign-in page below/);
  // Not before Claude has printed a link, and never a link that is not https.
  const early = harness({ start: {}, connect: {}, cloud: true });
  early.page.acctFlowPaint({ phase: 'signin-browser-open', url: null });
  assert.equal(early.document.getElementById('acct-claude-open-row').hidden, true, 'a link row with no link');
  // S5 design review: with no link yet it says one is coming, never "below".
  assert.match(early.document.getElementById('acct-flow-say').textContent, /Its link appears here in a moment/);
  assert.doesNotMatch(early.document.getElementById('acct-flow-say').textContent, /below/);
  const odd = harness({ start: {}, connect: {}, cloud: true });
  odd.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: 'javascript:alert(1)' });
  assert.equal(odd.document.getElementById('acct-claude-open-row').hidden, true, 'a non-https link was offered');
  // CONTROL: on a Mac the row stays hidden (the sign-in opens a browser there) and the words are the Mac's.
  const mac = harness({ start: {}, connect: {} });
  mac.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: URL });
  assert.equal(mac.document.getElementById('acct-claude-open-row').hidden, true, 'the Mac Settings flow changed');
});

test('kosmos#4903 S5 review 1: a link that arrives on the SAME phase still lands in Settings, and a changed one replaces it', () => {
  const h = harness({ start: {}, connect: {}, cloud: true });
  const row = () => h.document.getElementById('acct-claude-open-row');
  const href = () => h.document.getElementById('acct-claude-open').href;
  h.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: null });
  assert.equal(row().hidden, true, 'PRE-CONTROL: no link yet');
  h.document.getElementById('acct-code').value = 'typed-so-far';
  h.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?state=one' });
  assert.equal(row().hidden, false, 'the late link never appeared (the repeat check dropped it)');
  assert.equal(href(), 'https://claude.com/oauth?state=one');
  h.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?state=two' });
  assert.equal(href(), 'https://claude.com/oauth?state=two', 'a changed link kept the stale one');
  assert.equal(h.document.getElementById('acct-code').value, 'typed-so-far', 'the code field was rebuilt under the person');
  // S5 design review: the sentence above the link follows it, inside the phase.
  assert.match(h.document.getElementById('acct-flow-say').textContent, /sign-in page below/, 'the late link left the sentence saying it is coming');
  // Review 2 (W2): a reason on screen is never replaced by the generic sentence when the link changes.
  h.document.getElementById('acct-flow-say').textContent = 'That code did not work. Try the newest one.';
  h.page.acctFlowPaint({ phase: 'signin-awaiting-code', url: null });
  assert.equal(h.document.getElementById('acct-flow-say').textContent, 'That code did not work. Try the newest one.', 'the link going away replaced the reason a code failed');
  h.page.acctFlowPaint({ phase: 'signin-completing', url: 'https://claude.com/oauth?state=two' });
  assert.equal(row().hidden, true, 'review 2: the link stayed while Claude was finishing (a second press starts a second sign-in)');
  h.page.acctFlowPaint({ phase: 'connected', url: 'https://claude.com/oauth?state=two' });
  assert.equal(row().hidden, true, 'the link stayed after the sign-in ended');
});
