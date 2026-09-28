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
function harness({ start, connect }) {
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
    lift(SCRIPT, 'frConnActive'), lift(SCRIPT, 'acctFlowStop'), lift(SCRIPT, 'acctFocusAfterFlow'),
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
  return { page, timers, polls, tick };
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
