'use strict';

/**
 * #5948: a message to an agent whose sign-in stopped working is HELD in the #5805 queue, not typed and counted
 * delivered, and is typed in order once the agent is signed in again. The card is made signed out through the seam a
 * Windows supervisor writes (the automatic blocked "provider api (authentication_failed)" report), on a real fleet card;
 * "was it typed" reads the scripted tmux runner's recorded pastes.
 *
 *   node --test engine/signinhold-5948.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-signinhold-5948-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const status = require('./status');
const limitqueue = require('./limitqueue');
const selfreport = require('./selfreport');
const store = require('./store');
const fleet = require('../test-support/fleet');

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

const RULE = '─'.repeat(80) + '\n';
const IDLE_SCREEN = '> hello\n  ⎿  Done.\n' + RULE + '❯ \n' + RULE + '  casey · Opus 4.8\n'
  + '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents\n';
const SIGNED_OUT = { state: 'blocked', auto: true, on: 'provider api (authentication_failed)', owner: 'provider',
  because: 'Not signed in. To authenticate without a browser, run: grok login --device-code' };

function fakeTmux(screen) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen || '', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.pastedTo = (session) => {
    const out = [];
    let cur = '', target = null, has = false;
    for (const a of calls) {
      if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
      else if (a[0] === 'paste-buffer') target = a[a.length - 1];
      else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { out.push({ text: cur, target }); cur = ''; target = null; has = false; }
    }
    return out.filter((s) => String(s.target || '').startsWith('=' + session)).map((s) => s.text);
  };
  return fn;
}
function arm(screen) {
  const t = fakeTmux(screen);
  chat.setRunner(t);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return t;
}

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  limitqueue.resetForTests();
  for (const d of [messages.LOG, limitqueue.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* leo sends; casey is the recipient, signed out through the seam (signedOut) or not. The fleet is installed twice:
   once to learn casey's board name for the report, then again so the card is read with the report in place. */
async function withFleet(signedOut, fn, runner = 'grok') {
  const specs = (st) => [fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: st, runner, command: runner, screen: IDLE_SCREEN })];
  const first = fleet.install(specs('idle'));
  const name = first.agents.find((c) => c.sessionName === 'casey').name;
  first.restore();
  if (signedOut) assert.equal(selfreport.record(name, SIGNED_OUT).recorded, true);
  // state null: the card's state is the report's and the screen's, asserted by each test (as limithold-5805 does).
  const board = fleet.install(specs(null));
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  try { return await fn(board, arm(IDLE_SCREEN), name); } finally { chat.resetForTests(); board.restore(); }
}
const caseyOf = (board) => board.agents.find((c) => c.sessionName === 'casey');

test('#5948: a timer\'s line to a signed-out agent is held, with signin words and nothing typed; CONTROL: typed when signed in', async () => {
  await withFleet(true, async (board, tmux) => {
    assert.equal(caseyOf(board).state, status.STATE.AUTH_FAILED, 'the fixture is not a signed-out card');
    for (const v of [chat.deliverAutomatic('casey', 'A colleague line.', board.agents),
      await chat.deliverAutomaticAsync('casey', 'A colleague line.', board.agents)]) {
      assert.equal(v.held, true, JSON.stringify(v));
      assert.equal(v.heldFor, 'signin');
      assert.equal(v.state, chat.DELIVERY.COULD_NOT, 'held must not read as delivered');
      assert.match(v.because, /signed out/);
      assert.doesNotMatch(v.because, /usage/);
    }
    assert.deepEqual(tmux.pastedTo('casey'), [], 'a held line was typed');
  });
  fs.rmSync(selfreport.DIR, { recursive: true, force: true });   // the control: the same agent, never signed out
  await withFleet(false, async (board, tmux) => {
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.equal(tmux.pastedTo('casey').length, 1, 'CONTROL: an idle agent was not typed to, so the hold test proves nothing');
  });
});

test('#5948: kosmos msg to a signed-out agent is kept, told in signin words; the sweep types it, noted, once signed in', async () => {
  let kept;
  await withFleet(true, async (board, tmux, name) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'go ahead with the release' }, board.agents);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldFor, 'signin');
    assert.equal(v.heldUntil, null, 'a sign-in has no time to promise');
    assert.match(v.because, /is signed out; Kosmos types it once it is signed in again/);
    assert.deepEqual(tmux.pastedTo('casey'), []);
    kept = limitqueue.list('casey');
    assert.deepEqual(kept.map((e) => [e.id, e.signin]), [[v.id, true]]);
    // Not released while it is still signed out.
    assert.equal(chat.limitQueueReleased(caseyOf(board), board.agents), false);
    // Signed in again: a non-automatic report after a turn that worked (the Windows supervisor's clearing write).
    assert.equal(selfreport.record(name, { state: 'idle', because: 'answered' }).recorded, true);
  });
  await withFleet(false, async (board, tmux) => {
    assert.equal(chat.limitQueueReleased(caseyOf(board), board.agents), true, 'CONTROL: never released once signed in');
    await limitqueue.flush(board.agents, { deliver: chat.deliverAutomaticAsync, isReleased: chat.limitQueueReleased,
      resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped });
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1, 'the kept message was not typed after signing in: ' + JSON.stringify(typed));
    assert.match(typed[0], /go ahead with the release/);
    assert.match(typed[0], /\[kept for you while you were signed out; sent /);
    assert.deepEqual(limitqueue.list('casey'), []);
  });
});

test('#5948 review 1: a Claude agent\'s own sign-in StopFailure line does not hold its messages (nothing on the Mac clears it)', async () => {
  await withFleet(true, async (board, tmux) => {
    assert.notEqual(caseyOf(board).state, status.STATE.AUTH_FAILED, JSON.stringify(caseyOf(board).state));
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.equal(tmux.pastedTo('casey').length, 1, 'a Claude agent was held on its own sign-in report');
  }, 'claude');
});

test('#5948 review 2: a second message during the same sign-out is held as signed out too, not "behind"', async () => {
  await withFleet(true, async (board) => {
    const a = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'first' }, board.agents);
    const b = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'second' }, board.agents);
    for (const v of [a, b]) {
      assert.equal(v.heldFor, 'signin', JSON.stringify(v));
      assert.notEqual(v.behind, true, JSON.stringify(v));
      assert.doesNotMatch(v.because, /usage/);
    }
    assert.deepEqual(limitqueue.list('casey').map((e) => e.signin), [true, true]);
  });
});

test('#5948 review 2: a screen-read auth_failed (no report) is not held, as before this change', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'auth_failed', runner: 'claude' })]);
  try {
    const card = caseyOf(board);
    assert.equal(card.state, status.STATE.AUTH_FAILED, 'CONTROL: the fixture is not a signed-out screen');
    assert.notEqual(card.stateReported, true);
    assert.equal(chat.signinHeldVerdict('casey', board.agents), null);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5948 review 3: the same message sent again while it is held says signed out, as the first send did', async () => {
  await withFleet(true, async (board) => {
    const a = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'go ahead' }, board.agents);
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'go ahead' }, board.agents);
    assert.deepEqual([again.id, again.duplicate, again.heldFor], [a.id, true, 'signin'], JSON.stringify(again));
    assert.doesNotMatch(again.because, /usage/);
  });
});
