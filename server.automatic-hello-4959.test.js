'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4959, through the REAL DM thread route: the board's automatic 'hello' (the restart wake) posts
 * `{ text, automatic: true }`, which delivers through chat.deliverAutomaticAsync, the gate every other automatic
 * sender uses (#4588). A held verdict typed nothing, so it is answered as it is and NOT filed in the thread.
 * A person's own message (no flag) stays on chat.deliverAsync and is never held.
 *
 * The two deliver functions are replaced with recorders for each request, so which path the route took is
 * measured, and nothing can reach a pane. The real gate behind deliverAutomaticAsync has its own suite
 * (engine/agyhold-deliver-4588.test.js).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-autohello-4959-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

const NAME = 'agy4959';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

const until = new Date(Date.now() + 30 * 60e3).toISOString();
const HELD = { state: chat.DELIVERY.COULD_NOT, held: true, heldUntil: until, because: 'held: quota out until ' + until,
  at: new Date().toISOString(), paneState: null, paneNote: null };
const PLACED = () => ({ state: chat.DELIVERY.PLACED, at: new Date().toISOString(), because: null, paneState: null, paneNote: null });

/** One POST to the real route with both deliver paths recorded; `auto` is what deliverAutomaticAsync answers. */
async function post(body, auto, suffix = '/thread') {
  const calls = [];
  const realA = chat.deliverAutomaticAsync; const realP = chat.deliverAsync;
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  try {
    // Installed inside the try (review 2), so the finally always puts the real ones back.
    chat.deliverAutomaticAsync = async (...a) => { calls.push(['automatic', a[1]]); return auto; };
    chat.deliverAsync = async (...a) => { calls.push(['plain', a[1]]); return PLACED(); };
    const res = await fetch(`${base}/api/agent/${NAME}${suffix}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, out: await res.json().catch(() => null), calls };
  } finally {
    chat.deliverAutomaticAsync = realA; chat.deliverAsync = realP;
    board.restore();
  }
}
const rows = () => { try { return chat.readThread(chat.DIRECT, NAME).messages || []; } catch { return []; } };

test('#4959: an automatic hello held on the quota goes through the gate, answers held, and is not filed', async () => {
  const before = rows().length;
  const r = await post({ text: 'hello', automatic: true }, HELD);
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, [['automatic', 'hello']], 'the automatic hello did not take the gated path alone');
  assert.equal(r.out.delivery.held, true);
  assert.equal(r.out.delivery.heldUntil, until);
  assert.equal(r.out.recorded, false);
  assert.equal(rows().length, before, 'a hello the agent never got was filed in the thread');
});

test('#4959: an automatic hello the gate lets through is filed as before', async () => {
  const before = rows().length;
  const r = await post({ text: 'hello', automatic: true }, PLACED());
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, [['automatic', 'hello']]);
  assert.equal(r.out.delivery.state, chat.DELIVERY.PLACED);
  assert.equal(rows().length, before + 1, 'a placed automatic hello was not filed');
});

test('#4959 CONTROL: a person\'s own message (no flag) stays on the plain path and is never held', async () => {
  const before = rows().length;
  const r = await post({ text: 'hello' }, HELD);
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, [['plain', 'hello']], 'a person\'s message went through the quota gate');
  assert.equal(rows().length, before + 1);
});

test('#4959: automatic is exactly true or absent, and only on plain text; anything else is refused before delivery', async () => {
  for (const body of [
    { text: 'hello', automatic: 'yes' },
    { text: 'hello', automatic: false },
    { text: 'hello', automatic: 1 },
    { text: 'hello', automatic: true, reply_to: '2026-10-01T00:00:00.000Z' },
    { text: '1', automatic: true, chose: 'Yes' },
    { text: 'hello', automatic: true, attachments: ['a1'] },
    { text: 'hello', automatic: true, attachment: 'a1' },
  ]) {
    const r = await post(body, HELD);
    assert.equal(r.status, 400, JSON.stringify(body) + ' -> ' + JSON.stringify(r.out));
    assert.deepEqual(r.calls, [], JSON.stringify(body) + ' reached a deliver');
  }
});

/* Review 1: the handoff-restart pickup is the wake hello's twin (the board's own line after a restart), so it is held
   the same way. A held verdict is COULD_NOT, which this route answers 409, and the page shows its manual line. */
test('#4959: the handoff-restart pickup goes through the gate, and a held pickup answers 409 with the held verdict', async () => {
  const held = await post({}, HELD, '/handoff-restart/pickup');
  assert.equal(held.calls.length, 1, JSON.stringify(held));
  assert.equal(held.calls[0][0], 'automatic', 'the pickup did not take the gated path');
  assert.equal(held.status, 409, JSON.stringify(held.out));
  assert.equal(held.out.delivery.held, true);
  const placed = await post({}, PLACED(), '/handoff-restart/pickup');
  assert.equal(placed.status, 200, 'CONTROL: a pickup the gate lets through is answered 200: ' + JSON.stringify(placed.out));
  assert.deepEqual(placed.calls.map((c) => c[0]), ['automatic']);
});
