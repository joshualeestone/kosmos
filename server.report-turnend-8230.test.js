'use strict';

/**
 * kosmos#8230, the board's half, on the real route (a sandboxed board, as server.blocked-owner-person-5318.test.js):
 *  - a not-recorded answer from the record names its skip (`skipped`), so the Windows report hook can tell the
 *    board's deliberate keep of a standing wait from a refusal, and neither retries nor notes it;
 *  - an AUTOMATIC turn end refused before the record writes one board-log line, but only for a request carrying an
 *    agent token: the person's own sessions (no token) and an agent's own report (not automatic) write nothing.
 *   node --test server.report-turnend-8230.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8230-'));
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
const WHO = 'leo';

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function report(body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-agent-token'] = token;
  const res = await fetch(base + '/api/report', { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

/* The board-log lines this route wrote while `fn` ran (process.stdout.write, where the board logs). */
async function logged(fn) {
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.startsWith('report: refused an automatic')) { lines.push(s.trim()); return true; }
    return orig(chunk, ...rest);
  };
  try { await fn(); } finally { process.stdout.write = orig; }
  return lines;
}

test('kosmos#8230: an automatic idle over a standing question is answered with the record\'s skip named', async () => {
  const board = fleet.install([fleet.agent(WHO, { state: 'idle' })]);
  try {
    const token = sendertoken.mint(WHO).token;
    const clean = await report({ state: 'idle', text: 'finished responding', auto: true }, token);
    assert.equal(clean.recorded, true, 'CONTROL: an automatic idle with nothing standing is recorded: ' + JSON.stringify(clean));
    assert.equal(clean.skipped, undefined);

    const asked = await report({ state: 'needs_you', text: 'Which release does this go in?' }, token);
    assert.equal(asked.recorded, true, JSON.stringify(asked));
    const kept = await report({ state: 'idle', text: 'finished responding', auto: true }, token);
    assert.equal(kept.recorded, false, 'the automatic idle overwrote the question: ' + JSON.stringify(kept));
    assert.equal(kept.skipped, 'waiting', 'the record\'s skip is not named: ' + JSON.stringify(kept));
    assert.match(String(kept.because), /did not overwrite/);
  } finally { board.restore(); }
});

test('kosmos#8230: a refused automatic turn end is logged only when it carries an agent token', async () => {
  const board = fleet.install([fleet.agent('mira', { state: 'idle' })]);
  try {
    const unknown = 'ef'.repeat(16);   // an agent token the board never minted
    const withToken = await logged(async () => {
      const r = await report({ state: 'idle', text: 'finished responding', auto: true }, unknown);
      assert.equal(r.recorded, false, JSON.stringify(r));
    });
    assert.equal(withToken.length, 1, 'expected one board-log line: ' + JSON.stringify(withToken));
    assert.match(withToken[0], /^report: refused an automatic idle \(.+\)$/);
    assert.ok(!withToken[0].includes(unknown), 'the token reached the board log');

    const noToken = await logged(async () => {
      const r = await report({ state: 'idle', text: 'finished responding', auto: true }, null);
      assert.equal(r.recorded, false, 'CONTROL: a turn end with no token is refused too: ' + JSON.stringify(r));
    });
    assert.deepEqual(noToken, [], 'the person\'s own refused turn end was logged');

    const deliberate = await logged(async () => {
      const r = await report({ state: 'idle', text: 'done' }, unknown);
      assert.equal(r.recorded, false, JSON.stringify(r));
    });
    assert.deepEqual(deliberate, [], 'an agent\'s own (not automatic) report was logged');
  } finally { board.restore(); }
});
