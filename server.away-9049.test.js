'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#9049: a /clear, or a resume after a quit, continues a conversation whose SessionEnd recorded `stopped` over the
 * agent's own wait, and no `started` follows, so #8634's startup reminder never came. GET /api/away?wait=only answers
 * that reminder alone (as=waithook for the hooks, wait=only by hand), and only when the newest session event after the
 * wait is a `stopped`; with none yet it is `pending` (a crash, or a clear whose stopped has not landed).
 *
 *   node --test server.away-9049.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9049away-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, selfreport.fileFor('leo')]);

const TOK = 'BOARDTOKEN_9049_0123456789abcdef';
const M = 60 * 1000;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.token = TOK;
  boardAuthState.on = false;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

function withBoard(fn2) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  return Promise.resolve().then(() => fn2()).finally(() => {
    board.restore();
    try { fs.rmSync(selfreport.fileFor('leo'), { force: true }); } catch { /* none */ }
  });
}
function writeHistory(rows) {
  const file = selfreport.fileFor('leo');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: new Date(r.at).toISOString() })).join('\n') + '\n');
}
async function ask(tok, q) {
  const res = await fetch(base + '/api/away?' + q, { headers: { 'x-kosmos-agent-token': tok }, redirect: 'manual' });
  return { code: res.status, text: await res.text() };
}
const now = () => Date.now();

test('a wait a session END set aside is the whole answer, in the words for a session that ended', async () => {
  await withBoard(async () => {
    const t = now();
    writeHistory([
      { state: 'needs_you', by: 'agent', because: 'SECRET-WORDS may I merge', at: t - 30 * M },
      { state: 'idle', by: 'auto', because: 'finished responding', at: t - 29 * M },
      { state: 'stopped', by: 'auto', because: '', at: t - 28 * M },
    ]);
    const tok = sendertoken.mint('leo').token;
    try {
      const r = await ask(tok, 'as=waithook');
      assert.equal(r.code, 200, r.text);
      const ctx = JSON.parse(r.text).hookSpecificOutput.additionalContext;
      assert.match(ctx, /last reported that it was waiting \(needs_you, at /);
      assert.match(ctx, /The board has since set that waiting report aside/);
      assert.match(ctx, /if not, report what it is doing \(kosmos report working \.\.\.\) so Kosmos stops reminding it\./);
      assert.doesNotMatch(ctx, /A new run replaces/, 'the startup wording is not this case');
      assert.doesNotMatch(ctx, /could not reach it/, 'the digest is not replayed to a session that saw it');
      assert.doesNotMatch(ctx, /SECRET-WORDS/, 'the report\'s own words are never repeated');
      // The JSON form carries the wait, the text form says the same sentence.
      const j = JSON.parse((await ask(tok, 'wait=only')).text);
      assert.equal(j.ok, true);
      assert.equal(j.wait && j.wait.state, 'needs_you');
      assert.match((await ask(tok, 'as=text&wait=only')).text, /The board has since set that waiting report aside/);
    } finally { sendertoken.revoke('leo'); }
  });
});

test('a wait with no session event after it (a resume after a crash, or a clear whose stopped has not landed) is pending, never a reminder', async () => {
  await withBoard(async () => {
    const t = now();
    writeHistory([
      { state: 'blocked', by: 'agent', because: 'waiting on review', at: t - 30 * M },
      { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 29 * M },
    ]);
    const tok = sendertoken.mint('leo').token;
    try {
      const r = await ask(tok, 'as=waithook');
      assert.equal(r.code, 200);
      assert.equal(r.text, '{"pending":true}', 'no session event after the wait yet: the hook asks once more, and says nothing false');
      const j = JSON.parse((await ask(tok, 'wait=only')).text);
      assert.equal(j.wait, null);
      assert.equal(j.pending, true);
      // A `stopped` BEFORE the wait does not count: quit, startup, a new wait, a crash, a resume is pending too.
      writeHistory([
        { state: 'stopped', by: 'auto', because: '', at: t - 60 * M },
        { state: 'started', by: 'auto', because: '', at: t - 50 * M },
        { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 30 * M },
        { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 29 * M },
      ]);
      assert.equal((await ask(tok, 'as=waithook')).text, '{"pending":true}');
      assert.match((await ask(tok, 'as=text&wait=only')).text, /has not yet heard a session end/);
      // CONTROL: the same history at a real startup still reminds, in the startup words.
      const s = await ask(tok, 'as=hook&at=startup');
      assert.match(JSON.parse(s.text).hookSpecificOutput.additionalContext, /A new run replaces a waiting report on the board/);
    } finally { sendertoken.revoke('leo'); }
  });
});

test('a /clear after a startup that reminded is reminded again (the clear wiped that context); a crash after the startup is not', async () => {
  await withBoard(async () => {
    const t = now();
    const tok = sendertoken.mint('leo').token;
    try {
      writeHistory([
        { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 40 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 39 * M },
        { state: 'started', by: 'auto', because: '', at: t - 30 * M },
        { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 29 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 28 * M },
      ]);
      assert.match(JSON.parse((await ask(tok, 'as=waithook')).text).hookSpecificOutput.additionalContext, /has since set that waiting report aside/);
      writeHistory([
        { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 40 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 39 * M },
        { state: 'started', by: 'auto', because: '', at: t - 30 * M },
        { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 29 * M },
      ]);
      assert.equal((await ask(tok, 'as=waithook')).text, '', 'the newest session event is the startup, which reminded already');
      // The same history at a /clear: its own SessionEnd's `stopped` has not landed yet, so it is pending, not "reminded".
      assert.equal((await ask(tok, 'as=waithook&src=clear')).text, '{"pending":true}');
      // as=hook with wait=only keeps the hook contract (hook JSON or empty), never a JSON object.
      assert.equal((await ask(tok, 'as=hook&wait=only&src=clear')).text, '{"pending":true}');
    } finally { sendertoken.revoke('leo'); }
  });
});

test('a wait the agent itself ended, or no wait at all, gets nothing even after a stopped', async () => {
  await withBoard(async () => {
    const t = now();
    const tok = sendertoken.mint('leo').token;
    try {
      writeHistory([
        { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 30 * M },
        { state: 'working', by: 'agent', because: 'merged, carrying on', at: t - 29 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 28 * M },
      ]);
      assert.equal((await ask(tok, 'as=waithook')).text, '');
      writeHistory([
        { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 30 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 28 * M },
      ]);
      assert.equal((await ask(tok, 'as=waithook')).text, '');
      assert.match((await ask(tok, 'as=text&wait=only')).text, /no wait of yours to remind you of/);
    } finally { sendertoken.revoke('leo'); }
  });
});

/* kosmos#9057: on Windows the roster row appears only once Claude Code registers the session, and a resume sends no
   report, so after a quit more than liveness.STALE_AFTER_MS old the agent's own token matched neither a row nor a
   heartbeat and as=waithook was refused (403, empty): the reminder was lost. The away route now lets that token prove
   itself the way a `started` report does (startedMayProveLife), for as=waithook only, from this computer, and writes
   nothing. `winana` is such an agent: a profile and a held token, no row, no heartbeat. */
test('kosmos#9057: a Windows resume long after a quit is reminded of its own wait, with no row and no heartbeat', async () => {
  const serverMod = require('./server');
  const store = require('./engine/store');
  const liveness = require('./engine/liveness');
  await withBoard(async () => {
    const t = now();
    const file = selfreport.fileFor('winana');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 30 * M },
      { state: 'stopped', by: 'auto', because: '', at: t - 28 * M },
    ].map((r) => JSON.stringify({ ...r, at: new Date(r.at).toISOString() })).join('\n') + '\n');
    store.writeProfile('winana', { displayName: 'Win Ana' });
    const tok = sendertoken.mint('winana').token;
    try {
      assert.notEqual(liveness.alive('winana'), true, 'CONTROL: no heartbeat, as after a quit older than 3 minutes');
      // CONTROL: on a Mac or Linux board this path does not exist, so the ask is refused exactly as before.
      const mac = await ask(tok, 'as=waithook');
      assert.equal(mac.code, 403);
      assert.equal(mac.text, '', 'a refused caller gets the empty body, never {"pending":true}');
      serverMod._setStartedProofPlatformForTest('win32');
      const r = await ask(tok, 'as=waithook');
      assert.equal(r.code, 200, r.text);
      assert.match(JSON.parse(r.text).hookSpecificOutput.additionalContext, /The board has since set that waiting report aside/);
      assert.notEqual(liveness.alive('winana'), true, 'the ask wrote no heartbeat');
      assert.equal(selfreport.history('winana', selfreport.HISTORY_MAX_BYTES).length, 2, 'the ask recorded no report');
      // Only the hooks' resume question is widened: the startup ask (which follows a `started`) and the by-hand forms are not.
      const startup = await ask(tok, 'as=hook&at=startup');
      assert.equal(startup.code, 403);
      assert.equal(startup.text, '');
      assert.equal((await ask(tok, 'wait=only')).code, 403);
      // A token Kosmos never issued, or one revoked, is still refused with the empty body.
      const never = await ask('ab'.repeat(32), 'as=waithook');
      assert.equal(never.code, 403);
      assert.equal(never.text, '');
      sendertoken.revoke('winana');
      const revoked = await ask(tok, 'as=waithook');
      assert.equal(revoked.code, 403);
      assert.equal(revoked.text, '');
    } finally {
      serverMod._setStartedProofPlatformForTest(null);
      sendertoken.revoke('winana');
      try { fs.rmSync(file, { force: true }); } catch { /* none */ }
    }
  });
});
