'use strict';
/**
 * kosmos#5902: a person's post from their OWN other computer releases a held room, as a post typed here does.
 *
 * Driven through server.js's REAL recordExternal (the one fedseats calls when a seat delivers a post): the test keeps
 * the dependencies server.js hands fedseats.configure, so the wiring itself runs, not a stand-in for it. Proves:
 *   - a held room (CONTROL: held before the post) is released by a post the relay stamps same_account and a person
 *     wrote, and the release is a reopen row naming that external post, at its time, reason own-computer;
 *   - a stranger's post (no same_account), an agent's post from the person's other computer, a stamp that is not
 *     exactly true, and any post with KOSMOS_OWN_ROOM_NUDGE=0 all leave the room held and write no reopen.
 *
 *   node --test server.ownpostvalve-5902.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownpostvalve-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
delete process.env.KOSMOS_OWN_ROOM_NUDGE;

const test = require('node:test');
const assert = require('node:assert/strict');

/* Keep what server.js wires, before server.js loads. */
const fedseats = require('./engine/fedseats');
const realConfigure = fedseats.configure;
let wiredDeps = null;
fedseats.configure = (d) => { wiredDeps = d; return realConfigure(d); };
const { server } = require('./server');
fedseats.configure = realConfigure;
const messages = require('./engine/messages');
const limits = require('./engine/limits');

test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
function append(row) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n');
}
let seq = 9000;
/* A room the valve holds: agent posts filling the budget, and the valve row (the shapes server.room-held-5800 uses). */
function holdRoom(project, now) {
  const n = limits.caps().roomArrivalsPerWindow;
  append({ kind: 'post', id: 'm' + (++seq), from: 'ann', project, text: 'x', at: iso(now - 12 * MIN),
    to: Array.from({ length: n }, (_, i) => 'mem' + i), outcomes: Object.fromEntries(Array.from({ length: n }, (_, i) => ['mem' + i, 'placed'])) });
  append({ kind: 'valve', from: 'ann', to: project, project, at: iso(now - 10 * MIN), stopped: true,
    because: 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.' });
  assert.ok(messages.roomHeld(project, Date.now()), 'CONTROL: the room ' + project + ' was not held before the post');
}
function reopensFor(project) {
  return fs.readFileSync(messages.LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.kind === 'reopen' && r.project === project);
}
const tick = () => new Promise((r) => setImmediate(r));   // the deferred nudge runs, and finds no project: harmless

test('the dependencies under test are the ones server.js wires', () => {
  assert.ok(wiredDeps && typeof wiredDeps.recordExternal === 'function', 'server.js did not hand fedseats a recordExternal');
  assert.equal(limits.caps().on, true, 'the limit must be on, or every room reads open for that reason');
});

test('#5902 a person\'s post from their own other computer releases the held room, as a reopen naming it', async () => {
  holdRoom('ownA', Date.now());
  const row = wiredDeps.recordExternal('ownA', { from: 'Josh', fromKind: 'person', text: 'from my laptop', sameAccount: true });
  await tick();
  assert.ok(row && row.id, 'the post was not recorded');
  assert.equal(messages.roomHeld('ownA', Date.now()), null, 'the room is still held after the person posted from their other computer');
  const re = reopensFor('ownA');
  assert.equal(re.length, 1, JSON.stringify(re));
  assert.equal(re[0].post, row.id, 'the reopen does not name the external post');
  assert.equal(re[0].at, row.at, 'the reopen is not at the post\'s own time');
  assert.equal(re[0].reason, 'own-computer');
  assert.equal(re[0].operator, true, 'a reopen without operator: true is dropped by the reader (rowShaped)');
});

for (const [what, msg] of [
  ['a stranger\'s post (no same_account stamp)', { from: 'Mallory', fromKind: 'person', text: 'hello' }],
  ['an agent\'s post from the person\'s other computer', { from: 'casey', fromKind: 'agent', text: 'done', sameAccount: true }],
  ['a stamp that is not exactly true', { from: 'Eve', fromKind: 'person', text: 'hi', sameAccount: 'true' }],
  ['a post with no fromKind', { from: 'Josh', text: 'hi', sameAccount: true }],
]) {
  test(`#5902 ${what} leaves the room held and writes no reopen`, async () => {
    const project = 'keep' + (++seq);
    holdRoom(project, Date.now());
    const row = wiredDeps.recordExternal(project, msg);
    await tick();
    assert.ok(row && row.id, 'CONTROL: the post itself was recorded');
    assert.ok(messages.roomHeld(project, Date.now()), what + ' released the room');
    assert.deepEqual(reopensFor(project), []);
  });
}

test('#5902 KOSMOS_OWN_ROOM_NUDGE=0 turns the release off with the nudge', async () => {
  process.env.KOSMOS_OWN_ROOM_NUDGE = '0';
  try {
    holdRoom('offA', Date.now());
    wiredDeps.recordExternal('offA', { from: 'Josh', fromKind: 'person', text: 'from my laptop', sameAccount: true });
    await tick();
    assert.ok(messages.roomHeld('offA', Date.now()), 'the opt-out did not keep the room held');
    assert.deepEqual(reopensFor('offA'), []);
  } finally { delete process.env.KOSMOS_OWN_ROOM_NUDGE; }
});
