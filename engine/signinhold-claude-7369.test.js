'use strict';

/**
 * #7369 (Mac): a Claude agent whose screen shows its sign-in being rejected ("Sign-in Issue") has its messages HELD in
 * the #5805 queue, as #5948 does for the other runners, and typed once the account's live check (authprobe, `claude auth
 * status`) reads it signed in again. Before this, signinHeldVerdict returned null for every Claude card, so messages
 * were typed into a session that could not answer and counted delivered.
 *
 * The REPORTED Claude case (StopFailure's automatic "provider api (authentication_failed)") is still not held: nothing
 * ever writes the report that ends it for Claude (plan signedout-5948.md, "Why not Claude"); signinhold-5948 pins it.
 * The card is a real fleet card on a real screen line; "was it typed" reads the scripted tmux runner's pastes.
 *
 *   node --test engine/signinhold-claude-7369.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-signinhold-claude-7369-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const status = require('./status');
const create = require('./create');
const authprobe = require('./authprobe');
const subscription = require('./subscription');
const limitqueue = require('./limitqueue');
const selfreport = require('./selfreport');
const store = require('./store');
const fleet = require('../test-support/fleet');

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

/* Claude Code's friendly sign-in line (#1884's captured shape) under its prompt, and the same screen signed in. */
const RULE = '─'.repeat(80) + '\n';
const SIGNED_OUT_SCREEN = '> hello\n● Please run /login · API Error: 401 OAuth access token has expired.\n' + RULE + '❯ \n' + RULE
  + '  casey · Opus 4.8\n';
const IDLE_SCREEN = '> hello\n  ⎿  Done.\n' + RULE + '❯ \n' + RULE + '  casey · Opus 4.8\n'
  + '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents\n';
const CLAUDE_WORDS = 'held: it is signed out of Claude; Kosmos sends it once it is signed in again';

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

/* The account side: a Kosmos job on the default Claude account (what create.readJob gives an agent Kosmos made; the
   test box has none), and `claude auth status` answering as `live` says. */
const realReadJob = create.readJob;
let liveAnswer = subscription.STATE.NONE;
function account(live, job = { configDir: null }) {
  liveAnswer = live;
  create.readJob = () => job;
  authprobe.resetForTest();
}
authprobe.setChecker(async () => ({ state: liveAnswer }));
const settle = () => new Promise((r) => setImmediate(r));

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  limitqueue.resetForTests();
  for (const d of [messages.LOG, limitqueue.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.afterEach(() => { create.readJob = realReadJob; authprobe.resetForTest(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* leo sends; casey is a Claude agent showing `screen`. state null: the card's state is the classifier's, asserted by
   each test. A look is taken first, so the account check the screen kicks has settled before the card is read. */
async function withFleet(screen, fn) {
  const board0 = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: null, runner: 'claude', screen })]);
  board0.restore();
  await settle();
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: null, runner: 'claude', screen })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  try { return await fn(board, arm(screen)); } finally { chat.resetForTests(); board.restore(); }
}
const caseyOf = (board) => board.agents.find((c) => c.sessionName === 'casey');

test('#7369: a Claude card whose screen shows its sign-in rejected is held, in Claude\'s words, and nothing is typed', async () => {
  account(subscription.STATE.NONE);
  await withFleet(SIGNED_OUT_SCREEN, async (board, tmux) => {
    const card = caseyOf(board);
    assert.equal(card.state, status.STATE.AUTH_FAILED, 'CONTROL: the fixture is not a signed-out screen: ' + card.state);
    assert.notEqual(card.stateReported, true, 'the screen class, not a report');
    const v = chat.signinHeldVerdict('casey', board.agents);
    assert.ok(v && v.held === true && v.heldBy === 'limit' && v.heldFor === 'signin', JSON.stringify(v));
    assert.equal(v.because, CLAUDE_WORDS);
    const d = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.equal(d.held, true, JSON.stringify(d));
    assert.equal(d.state, chat.DELIVERY.COULD_NOT, 'held must not read as delivered');
    assert.deepEqual(tmux.pastedTo('casey'), [], 'a held line was typed');
  });
});

test('#7369 CONTROL: an idle Claude card is not held, and its line is typed', async () => {
  account(subscription.STATE.NONE);
  await withFleet(IDLE_SCREEN, async (board, tmux) => {
    assert.equal(caseyOf(board).state, status.STATE.IDLE);
    assert.equal(chat.signinHeldVerdict('casey', board.agents), null);
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.equal(tmux.pastedTo('casey').length, 1, 'CONTROL: an idle agent was not typed to, so the hold test proves nothing');
  });
});

test('#7369: a screen-read Claude card the live check cannot ask about (no Kosmos job, a vendor home) is not held', async () => {
  for (const job of [null, { configDir: path.join(SANDBOX, '.kosmos-deepseek-x') }]) {
    account(subscription.STATE.NONE, job);
    await withFleet(SIGNED_OUT_SCREEN, async (board) => {
      assert.equal(caseyOf(board).state, status.STATE.AUTH_FAILED, 'CONTROL: it reads signed out');
      assert.equal(status.claudeSignInCheckable('casey'), false, JSON.stringify(job));
      assert.equal(chat.signinHeldVerdict('casey', board.agents), null, 'nothing could release it: ' + JSON.stringify(job));
    });
  }
  account(subscription.STATE.NONE);
  assert.equal(status.claudeSignInCheckable('casey'), true, 'CONTROL: a job on a Claude account is checkable');
});

test('#7369: kept while the check reads signed out; released and typed once it reads signed in, with nothing typed first', async () => {
  account(subscription.STATE.NONE);
  await withFleet(SIGNED_OUT_SCREEN, async (board, tmux) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'go ahead with the release' }, board.agents);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldFor, 'signin');
    assert.deepEqual(limitqueue.list('casey').map((e) => e.signin), [true]);
    assert.equal(chat.limitQueueReleased(caseyOf(board), board.agents), false, 'released while still signed out');
    await limitqueue.flush(board.agents, { deliver: chat.deliverAutomaticAsync, isReleased: chat.limitQueueReleased,
      resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped });
    assert.deepEqual(tmux.pastedTo('casey'), [], 'the sweep typed it while signed out');
  });
  /* The person signs in off-pane: the SAME screen (the old line is still there), the check now reads signed in. */
  account(subscription.STATE.CONNECTED);
  await withFleet(SIGNED_OUT_SCREEN, async (board, tmux) => {
    const card = caseyOf(board);
    assert.notEqual(card.state, status.STATE.AUTH_FAILED, 'the live check did not drop the stale line: ' + card.state);
    assert.equal(chat.signinHeldVerdict('casey', board.agents), null);
    assert.equal(chat.limitQueueReleased(card, board.agents), true, 'not released once signed in');
    await limitqueue.flush(board.agents, { deliver: chat.deliverAutomaticAsync, isReleased: chat.limitQueueReleased,
      resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped });
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1, 'the kept message was not typed after signing in: ' + JSON.stringify(typed));
    assert.match(typed[0], /go ahead with the release/);
    assert.deepEqual(limitqueue.list('casey'), []);
  });
});

test('#7369 CONTROL: a non-Claude screen-read auth_failed (no report) is still not held', async () => {
  account(subscription.STATE.NONE);
  const board = fleet.install([fleet.agent('casey', { state: 'auth_failed', runner: 'claude' })]);
  try {
    const asGrok = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, runner: 'grok' } : c));
    assert.equal(caseyOf(board).state, status.STATE.AUTH_FAILED, 'CONTROL: the fixture is signed out');
    assert.notEqual(chat.signinHeldVerdict('casey', board.agents), null, 'CONTROL: the Claude card is held');
    assert.equal(chat.signinHeldVerdict('casey', asGrok), null, 'a grok card is held only on its report (#5948)');
  } finally { chat.resetForTests(); board.restore(); }
});
