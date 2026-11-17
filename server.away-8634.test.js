'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#8634: at a startup, GET /api/away also reminds the agent of a wait it reported before it went down (its own
 * needs_you or blocked, since ended by nobody), which the restart's own reports replace on the board. The wait is read
 * from the LONG report history, because a busy agent's automatic reports can bury a day-old wait past the short read.
 *
 *   node --test server.away-8634.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8634away-'));
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

const TOK = 'BOARDTOKEN_8634_0123456789abcdef';
const H = 60 * 60 * 1000;
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
async function hookFor(tok) {
  const res = await fetch(base + '/api/away?as=hook&at=startup', { headers: { 'x-kosmos-agent-token': tok }, redirect: 'manual' });
  return { code: res.status, text: await res.text() };
}
/* A blocked by the agent, then `autos` automatic heartbeats after it (each line about 190 bytes, as on a real board). */
function history(autos, { ended } = {}) {
  const now = Date.now();
  const rows = [{ state: 'blocked', by: 'agent', because: 'SECRET-WORDS waiting on review', at: now - 20 * H }];
  if (ended) rows.push({ state: 'working', by: 'agent', because: 'back on it', at: now - 19 * H });
  for (let i = 0; i < autos; i += 1) rows.push({ state: i % 2 ? 'idle' : 'working', by: 'auto', because: 'answering a prompt, padding the line to a real length', at: now - 18 * H + i * 1000 });
  const file = selfreport.fileFor('leo');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: new Date(r.at).toISOString() })).join('\n') + '\n');
  return fs.statSync(file).size;
}

test('a wait buried under more than the short read of automatic reports still reaches the startup hook', async () => {
  await withBoard(async () => {
    const size = history(800);
    assert.ok(size > 64 * 1024, 'precondition: the wait sits past the 64 KB short read (' + size + ' bytes)');
    // CONTROL: the short read cannot see it, so only the long read can make the reminder.
    assert.equal(selfreport.history('leo').some((r) => r.state === 'blocked'), false, 'the short read must not reach the wait');
    const tok = sendertoken.mint('leo').token;
    try {
      const hook = await hookFor(tok);
      assert.equal(hook.code, 200, hook.text);
      const ctx = JSON.parse(hook.text).hookSpecificOutput.additionalContext;
      assert.match(ctx, /last reported that it was waiting \(blocked, at /);
      assert.match(ctx, /kosmos report blocked \.\.\./);
      assert.doesNotMatch(ctx, /SECRET-WORDS/);
    } finally { sendertoken.revoke('leo'); }
  });
});

test('CONTROL: a wait the agent ended before the restart makes no reminder (and nothing else to say is an empty body)', async () => {
  await withBoard(async () => {
    history(20, { ended: true });
    const tok = sendertoken.mint('leo').token;
    try {
      const hook = await hookFor(tok);
      assert.equal(hook.code, 200);
      assert.equal(hook.text, '');
    } finally { sendertoken.revoke('leo'); }
  });
});

test('by hand (inside a session) the wait is not this: no reminder, and the text keeps its own last line', async () => {
  await withBoard(async () => {
    const now = Date.now();
    const file = selfreport.fileFor('leo');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const rows = [{ state: 'started', by: 'auto', at: now - 3 * H }, { state: 'working', by: 'auto', at: now - 2 * H },
      { state: 'blocked', by: 'agent', because: 'waiting on review', at: now - H }];
    fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: new Date(r.at).toISOString() })).join('\n') + '\n');
    const tok = sendertoken.mint('leo').token;
    try {
      const text = await fetch(base + '/api/away?as=text', { headers: { 'x-kosmos-agent-token': tok } }).then((r) => r.text());
      assert.doesNotMatch(text, /waiting \(blocked/, 'a wait still on the board was described as replaced');
      assert.match(text, /Kosmos has no earlier report from you|Nothing arrived for you while you were not running/, text);
      const json = await fetch(base + '/api/away', { headers: { 'x-kosmos-agent-token': tok } }).then((r) => r.json());
      assert.equal(json.wait, null);
      // CONTROL: the same record on the startup path does carry it.
      const hook = await hookFor(tok);
      assert.match(JSON.parse(hook.text).hookSpecificOutput.additionalContext, /waiting \(blocked, at /);
    } finally { sendertoken.revoke('leo'); }
  });
});
