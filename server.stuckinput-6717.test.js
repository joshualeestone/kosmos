'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#6717, through the REAL routes: a draft Kosmos took out of an agent's input box comes back in the agent's
 * conversation as Kosmos's line at its time (never a stored message row), is dismissed by the person only, and is
 * never typed anywhere.
 *
 *   node --test server.stuckinput-6717.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stuck-6717-')));
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
const drafts = require('./engine/unsentdrafts');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

const NAME = 'stuck6717';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, drafts.fileFor(NAME), chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

async function withBoard(fn) {
  const typed = [];
  const real = { a: chat.deliverAutomaticAsync, p: chat.deliverAsync };
  chat.deliverAutomaticAsync = async (...a) => { typed.push(a); throw new Error('typed'); };
  chat.deliverAsync = async (...a) => { typed.push(a); throw new Error('typed'); };
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  try { return await fn(typed); } finally { chat.deliverAutomaticAsync = real.a; chat.deliverAsync = real.p; board.restore(); }
}
const dismiss = (id, headers = {}) => fetch(`${base}/api/agent/${NAME}/unsent-draft/dismiss`,
  { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ id }) });

test('kosmos#6717: the conversation shows the draft as Kosmos\'s line; only the person dismisses it; nothing is typed', () => withBoard(async (typed) => {
  const added = drafts.add(NAME, 'the words that were stuck', { since: new Date(Date.now() - 11 * 60e3).toISOString() });
  assert.equal(added.ok, true);
  const got = await (await fetch(`${base}/api/agent/${NAME}/thread`)).json();
  const row = (got.messages || []).find((m) => m && m.draft === true);
  assert.ok(row, 'the draft is in the conversation: ' + JSON.stringify(got.messages));
  assert.equal(row.kind, 'kosmos');
  assert.equal(row.text, 'the words that were stuck');
  assert.equal(row.draftId, added.id);
  assert.equal(row.from, null);
  let stored = [];
  try { stored = chat.readThread(chat.DIRECT, NAME).messages; } catch { stored = []; }
  assert.equal(stored.some((m) => m && m.text === 'the words that were stuck'), false, 'never stored as a message row');
  // An agent's token cannot dismiss it; a malformed or unknown id is refused.
  assert.equal((await dismiss(added.id, { 'x-kosmos-agent-token': 'a'.repeat(64) })).status, 403);
  assert.equal((await dismiss('not-an-id')).status, 400);
  assert.equal((await dismiss('ffffffffffff')).status, 404);
  assert.equal(drafts.list(NAME).length, 1, 'still kept after the refusals');
  const ok = await dismiss(added.id);
  assert.equal(ok.status, 200);
  assert.equal(drafts.list(NAME).length, 0);
  const after = await (await fetch(`${base}/api/agent/${NAME}/thread`)).json();
  assert.equal((after.messages || []).some((m) => m && m.draft === true), false, 'gone once dismissed');
  assert.equal((await dismiss(added.id)).status, 404, 'a second dismiss finds nothing');
  assert.deepEqual(typed, [], 'nothing was ever typed into the agent');
}));

test('kosmos#6717: the sweep is wired behind live execution and the operator brake, with the draft saver set', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const at = src.indexOf("require('./engine/stuckinput').makeTick(");
  assert.ok(at > 0, 'the sweep is not wired in server.js');
  const wiring = src.slice(src.lastIndexOf('chat.setDraftSaver(', at), src.indexOf('stuckInputSweep.unref()', at));
  assert.match(wiring, /chat\.setDraftSaver\(\(session, text, opts\) => require\('\.\/engine\/unsentdrafts'\)\.add\(session, text, opts\)\)/);
  assert.match(wiring, /allowed: \(\) => liveExecution\.liveExecutionAllowed\(\) && process\.env\.AGENT_WORKFORCE_STUCK_INPUT_OFF !== '1'/);
  assert.match(wiring, /recover: \(card, since\) => chat\.recoverStuckInput\(card, since\)/);
  assert.match(wiring, /stuckMs: chat\.STUCK_INPUT_MS/);
});
