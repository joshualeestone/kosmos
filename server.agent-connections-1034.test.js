'use strict';

/**
 * GET /api/agent/connections (#1034 part 2), driven against the real server.
 *
 * The verdict logic itself is covered exhaustively in
 * engine/connectionverdict.test.js. Re-deriving it here would be the private
 * second reader this codebase calls its worst-shipped habit. This file proves
 * the ROUTE, and one property that only exists once the route is wired:
 *
 *   🔑 THE REAL READERS ARE ATTACHED TO THE REAL BOUNDARY. A unit test proves
 *   the module redacts what it is handed; only this proves the route hands it
 *   to the module at all instead of answering connect.state() directly.
 *
 * ⚠️ Every root is sealed BEFORE any require, because an unsealed
 * AGENT_WORKFORCE_HOME makes this read the operator's real sign-ins -- and on
 * a machine with none it would pass vacuously while leaking on somebody
 * else's.
 *
 *   node --test server.agent-connections-1034.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentconn-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SANDBOX, 'codex');
process.env.CODEX_HOME = path.join(SANDBOX, 'codex');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const connect = require('./engine/connect');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  connect.resetForTests();
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('the route answers the constructed view, not connect.state()', async () => {
  const res = await fetch(base + '/api/agent/connections');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.providers), 'providers missing');
  assert.equal(body.providers.length, 2);
  assert.deepEqual(body.providers.map((p) => p.id).sort(), ['anthropic', 'openai']);
  assert.ok(body.signin && typeof body.signin.phase === 'string', 'signin verdict missing');
  assert.ok(Array.isArray(body.services), 'services missing');
  // The fields that prove it is NOT connect.state() coming back raw.
  assert.ok(!('url' in body), 'the sign-in URL reached the agent view');
  assert.ok(!('tail' in body), 'raw terminal output reached the agent view');
  assert.ok(!('configDir' in body), 'a filesystem path reached the agent view');
});

test('a LIVE sign-in carrying a bearer URL is visible to the board and NOT to an agent', async () => {
  /**
   * The card's whole point, driven end to end.
   *
   * ⚠️ An earlier version of this test asserted "no oauth in the response"
   * without planting anything, and passed against a state that had no URL to
   * leak -- a check that could not fail. So the plant is real (a foreign live
   * flow on disk, which is how connect.state() surfaces another window's
   * sign-in) and the CONTROL IS THE UNSAFE ROUTE ITSELF: /api/connect must
   * show the planted URL. If that arm ever goes quiet, this test has stopped
   * being able to detect a leak and must be fixed rather than trusted.
   */
  const URL_PLANT = 'https://claude.ai/oauth/authorize?code=PLANT9271&state=PLANT9271';
  const TAIL_PLANT = 'PLANTTAIL9271 paste code here: 4821-PLANT';
  const store = require('./engine/store');
  const stateFile = path.join(store.ROOT, 'connect.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    phase: 'signin-awaiting-code',
    // A real, live pid that is NOT ours, which is what makes state() treat
    // this as another window's flow rather than an interrupted corpse.
    pid: process.ppid,
    updatedAt: new Date().toISOString(),
    url: URL_PLANT,
    tail: TAIL_PLANT,
    configDir: '/Users/planted9271/Library/Application Support/Planted',
  }), 'utf8');

  // CONTROL ARM: the unsafe reader must actually be leaking, or the safe
  // arm below proves nothing.
  const unsafe = await (await fetch(base + '/api/connect')).text();
  assert.match(unsafe, /oauth/i, 'control failed: the plant never reached connect.state(), so the arm below is vacuous');
  assert.ok(unsafe.includes(URL_PLANT), 'control failed: the planted URL is not in the unsafe reader');
  assert.ok(unsafe.includes(TAIL_PLANT), 'control failed: the planted tail is not in the unsafe reader');

  // THE ARM THAT MATTERS: the same live flow, asked as an agent.
  const safe = await (await fetch(base + '/api/agent/connections')).text();
  assert.ok(!safe.includes(URL_PLANT), 'the bearer sign-in URL reached the agent view');
  assert.ok(!safe.includes(TAIL_PLANT), 'raw terminal output reached the agent view');
  assert.doesNotMatch(safe, /oauth/i, 'an OAuth URL reached the agent view');
  assert.doesNotMatch(safe, /paste code/i, 'terminal tail reached the agent view');
  assert.doesNotMatch(safe, /\/Users\//, 'a filesystem path reached the agent view');

  // And the agent is still told something USEFUL about it: a sign-in is busy.
  const view = JSON.parse(safe);
  assert.equal(view.signin.phase, 'signin-awaiting-code');
  assert.equal(view.signin.busy, true);

  fs.rmSync(stateFile, { force: true });
});

test('HEAD answers 200 without paying for the live per-account sweep', async () => {
  /**
   * 🛑 THE OBVIOUS ASSERTION HERE CANNOT FAIL. An earlier version checked that
   * the HEAD body was empty. Measured: a server that DELIBERATELY writes a full
   * JSON body on HEAD still yields "" from `res.text()` (control: the same
   * server's GET returns it), because the HTTP client discards it. So deleting
   * the short-circuit at server.js would have left that test green while every
   * HEAD paid a live `claude auth status` per account plus every door call.
   *
   * ⇒ Cheapness is a TIMING property, so it is timed. The short-circuit returns
   * before any subprocess; the GET does not. The threshold is deliberately loose
   * (a multiple, not a millisecond count) because this runs on a contended box.
   */
  const t0 = Date.now();
  const res = await fetch(base + '/api/agent/connections', { method: 'HEAD' });
  const headMs = Date.now() - t0;
  assert.equal(res.status, 200);

  const t1 = Date.now();
  const g = await fetch(base + '/api/agent/connections');
  await g.text();
  const getMs = Date.now() - t1;

  // control: the GET must actually be doing work, or the comparison is vacuous
  assert.ok(getMs > 5, `control: the GET took ${getMs}ms, too fast to be doing the sweep`);
  assert.ok(headMs * 4 < getMs || headMs < 5,
    `HEAD (${headMs}ms) is not materially cheaper than GET (${getMs}ms), so it is paying for the sweep`);
});

test('every provider answers with the three-state vocabulary and a real sentence', async () => {
  /**
   * ⚠️ RENAMED TO WHAT IT CHECKS. It used to be called "no sign-ins reads as
   * none", which it never asserted: it would pass with BOTH providers reading
   * `unknown`, the opposite of the claim, and so could not detect a regression
   * that made the sandbox read blind. The vocabulary check is worth having; the
   * name was writing a cheque the assertions did not cover.
   */
  const body = await (await fetch(base + '/api/agent/connections')).json();
  assert.ok(body.providers.length > 0, 'control: no providers came back at all');
  for (const p of body.providers) {
    assert.ok(['connected', 'none', 'unknown'].includes(p.signedIn), `bad verdict ${p.signedIn}`);
    assert.equal(typeof p.because, 'string');
    assert.ok(p.because.length > 0);
  }
});

test('a reader that THROWS makes the route answer unknown, not a confident none', async () => {
  /**
   * 🛑 THE MODULE TEST PROVES THE FLAG WORKS. NOTHING PROVED THE ROUTE SETS IT.
   * A regression dropping `unreadable` from the `forAgent(...)` payload, or
   * changing `.catch(() => null)` to `.catch(() => [])`, leaves every other test
   * green and produces "this computer has no working sign-in for it" for a
   * machine we could not read. That is the exact failure the flag exists for.
   */
  const accounts = require('./engine/accounts');
  const real = accounts.listLive;
  accounts.listLive = () => Promise.reject(new Error('planted reader failure'));
  try {
    const body = await (await fetch(base + '/api/agent/connections')).json();
    const claude = body.providers.find((p) => p.id === 'anthropic');
    assert.equal(claude.signedIn, 'unknown',
      'a throwing reader was reported as a settled answer');
    assert.equal(claude.howMany, null, 'a count was printed for a machine we could not read');
  } finally {
    accounts.listLive = real;
  }
  // CONTROL: with the reader restored, the same provider reports a real verdict,
  // so the assertion above is about the throw and not about the route being broken.
  const after = await (await fetch(base + '/api/agent/connections')).json();
  const claudeAfter = after.providers.find((p) => p.id === 'anthropic');
  assert.notEqual(claudeAfter.signedIn, 'unknown',
    'control: the route still answers unknown with the reader restored, so this test proves nothing');
});

test('the served door names are human names, never route fragments', async () => {
  /**
   * The module passes `doorNames` through verbatim by design, so its safety is
   * this route's job. Nothing asserted that. This also guards the `svc/discord`
   * shape the route comment describes: `tokendoors.routes()` returns
   * `/api/svc/<slug>`, and a strip-the-prefix rule printed that at a person.
   */
  const body = await (await fetch(base + '/api/agent/connections')).json();
  assert.ok(Array.isArray(body.services));
  assert.ok(body.services.length > 0, 'control: no doors came back, so the assertions below are vacuous');
  for (const s of body.services) {
    assert.ok(!s.name.includes('/'), `a route fragment reached the screen: ${s.name}`);
    assert.ok(!/^svc\b/.test(s.name), `an unstripped svc prefix reached the screen: ${s.name}`);
    assert.ok(!s.name.startsWith('api'), `an unstripped api prefix reached the screen: ${s.name}`);
  }
  assert.ok(body.services.some((s) => s.name === 'GitHub'),
    'the first-party doors lost their human names');
});

test('the agent view carries every door the board view carries', async () => {
  /**
   * 🛑 A RECORDED HAZARD IS NOT A GUARD. The plan says plainly that the door
   * sweep is re-implemented inline here rather than shared, so "a fourth
   * first-party door added to /api/connections would silently never appear in
   * the agent view". That was written down and nothing checked it.
   *
   * This compares the two routes' door counts. It does not require the sweeps to
   * be shared, only that they stay in step, which is the property that actually
   * matters to a person asking an agent what is connected.
   */
  const board = await (await fetch(base + '/api/connections')).json();
  const agent = await (await fetch(base + '/api/agent/connections')).json();
  const boardDoors = Object.keys(board.doors || {});
  assert.ok(boardDoors.length > 0, 'control: the board route returned no doors, so this proves nothing');
  assert.equal(agent.services.length, boardDoors.length,
    `the agent view has ${agent.services.length} doors and the board has ${boardDoors.length}: `
    + 'one route gained a door the other did not, which is the drift the plan predicted');
});
