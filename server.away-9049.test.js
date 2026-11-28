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

require('./test-support/faketmux-win').serveOnWindows();   // kosmos#8378: fake tmux's reads on Windows, where its script cannot run
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
      // CONTROL: on a Mac or Linux board this path does not exist, so the ask is refused exactly as before. On a Windows
      // host (kosmos#8378) the board already is the Windows one the arm below pins, so the control has nothing to show.
      if (process.platform !== 'win32') {
        const mac = await ask(tok, 'as=waithook');
        assert.equal(mac.code, 403);
        assert.equal(mac.text, '', 'a refused caller gets the empty body, never {"pending":true}');
      }
      serverMod._setStartedProofPlatformForTest('win32');
      const r = await ask(tok, 'as=waithook');
      assert.equal(r.code, 200, r.text);
      assert.match(JSON.parse(r.text).hookSpecificOutput.additionalContext, /The board has since set that waiting report aside/);
      /* Review 2: the hook's own request (engine/kosmos-report-hook.js takeAway: from_pane=, the board token, the world
         header) against this real board, also with the board enforcing its token, is answered the same reminder. */
      const hook = require('./engine/kosmos-report-hook');
      const viaHook = await hook.takeAway({ url: base, agentToken: tok, boardToken: TOK, waitOnly: true });
      assert.match(viaHook, /^\{"hookSpecificOutput":/, 'the real hook request was not answered: ' + JSON.stringify(viaHook));
      boardAuthState.on = true;
      try {
        assert.match(await hook.takeAway({ url: base, agentToken: tok, boardToken: TOK, waitOnly: true }), /The board has since set that waiting report aside/);
      } finally { boardAuthState.on = false; }
      assert.notEqual(liveness.alive('winana'), true, 'the ask wrote no heartbeat');
      assert.equal(selfreport.history('winana', selfreport.HISTORY_MAX_BYTES).length, 2, 'the ask recorded no report');
      // Only the hooks' resume question is widened: the startup ask (which follows a `started`) and the by-hand forms are not.
      const startup = await ask(tok, 'as=hook&at=startup');
      assert.equal(startup.code, 403);
      assert.equal(startup.text, '');
      assert.equal((await ask(tok, 'wait=only')).code, 403);
      // Review 1: the same ask forwarded from another computer (Kosmos+ remote access sets x-forwarded-for) is refused.
      const fwd = await fetch(base + '/api/away?as=waithook', { headers: { 'x-kosmos-agent-token': tok, 'x-forwarded-for': '203.0.113.7' }, redirect: 'manual' });
      assert.equal(fwd.status, 403);
      assert.equal(await fwd.text(), '');
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

/* kosmos#9058: an agent that was answered in chat and carried on, never reporting otherwise, was reminded at every
   /clear and resume for 7 days, because automatic turns never end a wait. It is now reminded at the first session end
   after the wait and once more, then not again. Driven through the route, the hooks' as=waithook form. */
test('kosmos#9058: a wait is reminded at the first /clear and once more, then not at every later one', async () => {
  await withBoard(async () => {
    const t = now();
    const tok = sendertoken.mint('leo').token;
    const rows = [
      { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 60 * M },
      { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 59 * M },
      { state: 'stopped', by: 'auto', because: '', at: t - 58 * M },
    ];
    const reminded = async () => (await ask(tok, 'as=waithook')).text.startsWith('{"hookSpecificOutput":');
    try {
      writeHistory(rows);
      assert.equal(await reminded(), true, 'the first /clear after the wait is reminded');
      rows.push({ state: 'working', by: 'auto', because: 'answering a prompt', at: t - 50 * M },
        { state: 'idle', by: 'auto', because: 'finished responding', at: t - 49 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 48 * M });
      writeHistory(rows);
      assert.equal(await reminded(), true, 'one repeat: the /clear wiped the context that held the first reminder');
      rows.push({ state: 'working', by: 'auto', because: 'answering a prompt', at: t - 40 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 38 * M });
      writeHistory(rows);
      const r = await ask(tok, 'as=waithook');
      assert.equal(r.code, 200);
      assert.equal(r.text, '', 'it worked through two reminded sessions: no reminder, and never {"pending":true}');
      assert.equal(JSON.parse((await ask(tok, 'wait=only')).text).wait, null);
      assert.match((await ask(tok, 'as=text&wait=only')).text, /you have worked through at least 2 sessions since it without reporting again/);
      // CONTROL: /clears with no turn between them do not use up the reminders.
      writeHistory([rows[0], rows[1], rows[2],
        { state: 'stopped', by: 'auto', because: '', at: t - 30 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 20 * M },
        { state: 'stopped', by: 'auto', because: '', at: t - 10 * M }]);
      assert.equal(await reminded(), true, 'nothing was worked through, so it is still reminded');
    } finally { sendertoken.revoke('leo'); }
  });
});

test('kosmos#9058 review 1: a racing third /clear is not reminded, and a restart after two worked sessions is not either', async () => {
  await withBoard(async () => {
    const t = now();
    const tok = sendertoken.mint('leo').token;
    const base9058 = [
      { state: 'needs_you', by: 'agent', because: 'may I merge', at: t - 60 * M },
      { state: 'stopped', by: 'auto', because: '', at: t - 58 * M },
      { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 50 * M },
      { state: 'idle', by: 'auto', because: 'finished responding', at: t - 49 * M },
      { state: 'stopped', by: 'auto', because: '', at: t - 48 * M },
      { state: 'working', by: 'auto', because: 'answering a prompt', at: t - 40 * M },
      { state: 'idle', by: 'auto', because: 'finished responding', at: t - 39 * M },
    ];
    try {
      writeHistory(base9058);   // the third /clear's own stopped has not landed
      assert.equal((await ask(tok, 'as=waithook&src=clear')).text, '', 'the /clear ends a second worked session: no third reminder');
      // Review 4: an in-session /resume races its own stopped the same way, and is not reminded a third time either.
      assert.equal((await ask(tok, 'as=waithook')).text, '', 'an in-session /resume ends a second worked session too');
      // CONTROL: a resume after a quit, whose stopped landed long ago: the open session is empty, one worked session, reminded.
      writeHistory(base9058.slice(0, 5));
      assert.match((await ask(tok, 'as=waithook')).text, /^\{"hookSpecificOutput":/);
      // A by-hand ask inside a live session does not count that session as ending.
      writeHistory(base9058);
      assert.equal(JSON.parse((await ask(tok, 'wait=only')).text).wait.state, 'needs_you');
      // A restart: two worked sessions ended since the wait, so the startup reminder is not given either.
      writeHistory(base9058.concat([{ state: 'stopped', by: 'auto', because: '', at: t - 38 * M }]));
      const s2 = await ask(tok, 'as=hook&at=startup');
      assert.equal(s2.code, 200, 'review 3: an error also answers an empty body here');
      assert.doesNotMatch(s2.text, /last reported that it was waiting/);
      // CONTROL: after one worked session the startup still reminds, in the startup words.
      writeHistory(base9058.slice(0, 5));
      assert.match(JSON.parse((await ask(tok, 'as=hook&at=startup')).text).hookSpecificOutput.additionalContext, /A new run replaces a waiting report on the board/);
    } finally { sendertoken.revoke('leo'); }
  });
});

/* kosmos#9058 review 3: most restarts on this fleet leave no `stopped` (a killed or relaunched run sends no SessionEnd),
   so a session also ends at the next `started`. History with no `stopped` at all: the Mac asks at=startup before its
   `started` lands (the session it ends counts now); the Windows hook asks as=hook after it (its `started` closes it). */
test('kosmos#9058 review 3: restarts with no stopped rows stop reminding after two worked sessions, on a Mac and on Windows', async () => {
  await withBoard(async () => {
    const t = now();
    const tok = sendertoken.mint('leo').token;
    const s = (state, by, min) => ({ state, by, because: '', at: t - min * M });
    const reminded = (r) => r.code === 200 && /last reported that it was waiting/.test(r.text);
    try {
      // wait, crash, startup (reminded), a turn, crash: one worked session; the next startup still reminds.
      const one = [s('needs_you', 'agent', 60), s('started', 'auto', 50), s('working', 'auto', 49), s('idle', 'auto', 48)];
      writeHistory(one);
      assert.equal(reminded(await ask(tok, 'as=hook&at=startup')), true, 'Mac: the restart ending the first worked session reminds');
      writeHistory(one.concat([s('started', 'auto', 47)]));
      assert.equal(reminded(await ask(tok, 'as=hook')), true, 'Windows (after its started): one worked session, still reminds');
      // another crash after another worked session: two, so neither platform reminds.
      const two = one.concat([s('started', 'auto', 40), s('working', 'auto', 39), s('idle', 'auto', 38)]);
      writeHistory(two);
      const mac = await ask(tok, 'as=hook&at=startup');
      assert.equal(mac.code, 200);
      assert.equal(reminded(mac), false, 'Mac: two worked sessions, no reminder');
      writeHistory(two.concat([s('started', 'auto', 37)]));
      const win = await ask(tok, 'as=hook');
      assert.equal(win.code, 200);
      assert.equal(reminded(win), false, 'Windows: the same count at the same moment');
      // CONTROL: restarts with no turn between them use up nothing.
      writeHistory([s('needs_you', 'agent', 60), s('started', 'auto', 50), s('started', 'auto', 40), s('started', 'auto', 30)]);
      assert.equal(reminded(await ask(tok, 'as=hook&at=startup')), true);
    } finally { sendertoken.revoke('leo'); }
  });
});
