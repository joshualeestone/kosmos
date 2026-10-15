'use strict';
/**
 * #6231 item 9: the board's bulk account move gives the move a leftOnOld that writes #6174's note (engine/accountmoving)
 * for an agent left saved on the new account while it still runs on its old one: its session's start, and the account it
 * ran on before the move. Boots the real board; the move's deps are captured from the route, and the session reads are
 * set on engine/status (which server.js loads at call time).
 *
 *   node --test server.movenotes-6231.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-movenotes-'));
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [nodePath.join(SANDBOX, 'home'), BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
delete process.env.TMUX;
delete process.env.TMUX_PANE;
for (const b of ['claude', 'tmux']) fs.writeFileSync(nodePath.join(BIN, b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = nodePath.join(BIN, 'claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(BIN, 'tmux');

const accountmove = require('./engine/accountmove');
const accountmoving = require('./engine/accountmoving');
const create = require('./engine/create');
const status = require('./engine/status');
const updates = require('./engine/update');
updates.setFetcher(async () => ({ ok: false, status: 503, json: async () => null }));   // no network
const REAL = { start: accountmove.start, readJob: create.readJob, setAccount: create.setAccount,
  paneRosterAsync: status.paneRosterAsync, startedAsync: status.sessionStartedAtFromTmuxAsync };
function restoreAll() {
  accountmove.start = REAL.start; create.readJob = REAL.readJob; create.setAccount = REAL.setAccount;
  status.paneRosterAsync = REAL.paneRosterAsync; status.sessionStartedAtFromTmuxAsync = REAL.startedAsync;
  try { accountmoving.clear('al'); } catch { /* none */ }
}

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => { restoreAll(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.afterEach(restoreAll);

/* The route's deps, with al's account read as /acct/old before the (stubbed) write, as the route reads it. */
async function routeDeps(beforeSave = {}) {
  let deps = null;
  accountmove.start = (body, d) => { deps = d; return { status: 202, body: { id: 'm1', done: false, agents: [] } }; };
  const r = await fetch(base + '/api/agents/account', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ names: ['al'], dir: '/acct/new' }) });
  assert.equal(r.status, 202);
  assert.equal(typeof (deps && deps.leftOnOld), 'function', 'the board gave the move no leftOnOld');
  create.readJob = () => ({ configDir: '/acct/old' });
  create.setAccount = () => ({ outcome: 'changed', account: {} });
  beforeSave.at = Date.now();
  deps.setAccount('al', '/acct/new');   // records the account al ran on before the move, and when it was saved
  return deps;
}
/* The note is written after an async session read: wait until it lands (or a second passes). */
async function settle(done) {
  for (let i = 0; i < 100; i += 1) { if (done()) return; await new Promise((r) => setTimeout(r, 10)); }
}

test('#6231 item 9: the board notes an agent left on its old account with its session start and its old account', async () => {
  const deps = await routeDeps();
  status.paneRosterAsync = async () => [{ sessionName: 'al', session: 'al-session', isNamedOurs: true }];
  status.sessionStartedAtFromTmuxAsync = async () => 1234;
  deps.leftOnOld('al');
  await settle(() => accountmoving.notes().al);
  assert.deepEqual(accountmoving.notes().al, { started: 1234, from: '/acct/old' });
});

test('#6231 item 9 CONTROL: with its session unreadable, an earlier note is cleared, not a new one guessed', async () => {
  const deps = await routeDeps();
  accountmoving.note('al', 99, '/acct/elsewhere');
  status.paneRosterAsync = async () => [];
  deps.leftOnOld('al');
  await settle(() => !accountmoving.notes().al);
  assert.equal(accountmoving.notes().al, undefined);
});

test('#6231 item 9: a session that started after the move saved the new account is not noted, and an earlier note goes', async () => {
  const deps = await routeDeps();
  accountmoving.note('al', 99, '/acct/elsewhere');
  status.paneRosterAsync = async () => [{ sessionName: 'al', session: 'al-session', isNamedOurs: true }];
  status.sessionStartedAtFromTmuxAsync = async () => Date.now() + 60000;   // restarted since the save (onto the new account)
  deps.leftOnOld('al');
  await settle(() => !accountmoving.notes().al);
  assert.equal(accountmoving.notes().al, undefined, 'a session that started after the save was noted as on the old account');
});

test('#6231 item 9: the margin is one whole second before the save (tmux reads whole seconds)', async () => {
  const t = {};
  let deps = await routeDeps(t);
  status.paneRosterAsync = async () => [{ sessionName: 'al', session: 'al-session', isNamedOurs: true }];
  status.sessionStartedAtFromTmuxAsync = async () => t.at - 1000;   // a whole second before: noted
  deps.leftOnOld('al');
  await settle(() => accountmoving.notes().al);
  assert.equal(accountmoving.notes().al && accountmoving.notes().al.started, t.at - 1000);
  accountmoving.clear('al');
  deps = await routeDeps(t);
  status.paneRosterAsync = async () => [{ sessionName: 'al', session: 'al-session', isNamedOurs: true }];
  status.sessionStartedAtFromTmuxAsync = async () => t.at - 500;    // within the second: could be after it, not noted
  accountmoving.note('al', 1, '/acct/x');
  deps.leftOnOld('al');
  await settle(() => !accountmoving.notes().al);
  assert.equal(accountmoving.notes().al, undefined, 'a session within the save\'s second was noted');
});

test('#6231 item 9: a note written while the session is read (a later move) is kept, not overwritten', async () => {
  const deps = await routeDeps();
  status.paneRosterAsync = async () => { accountmoving.note('al', 777, '/acct/later'); return [{ sessionName: 'al', session: 'al-session', isNamedOurs: true }]; };
  let read;
  const wasRead = new Promise((r) => { read = r; });
  status.sessionStartedAtFromTmuxAsync = async () => { read(); return 1234; };
  deps.leftOnOld('al');
  await wasRead;   // the session start has been read, so the note's callback runs next
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(accountmoving.notes().al, { started: 777, from: '/acct/later' }, 'the later move\'s note was overwritten');
});
