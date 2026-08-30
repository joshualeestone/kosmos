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

test('the agent first-party set is DERIVED from the board, not pinned to a literal', async () => {
  /**
   * 🛑 THE SIBLING TEST BELOW PINS THE AGENT VIEW TO A LITERAL LIST, AND THAT
   * GUARDS THE WRONG DIRECTION. It goes red when the AGENT route gains a door,
   * which nobody is worried about, and stays green when `/api/connections` gains
   * one, which is precisely the drift the plan records:
   *
   *   "a fourth first-party door added to /api/connections would silently never
   *    appear in the agent view"
   *
   * The sweep is duplicated inline in both routes and the shared builder was
   * deliberately deferred out of a privacy change. A deferral with no guard is a
   * defect with a note attached, so this is the guard.
   *
   * ⚠️ COMPARED BY COUNT, NOT BY NAME, AND THE REASON IS THE FEATURE ITSELF. The
   * board answers `doors` keyed by ROUTE (`/api/github`); the agent view answers
   * `services` carrying human NAMES and deliberately no route fragment, which is
   * the privacy decision this card exists for. So the two cannot be compared by
   * identity without re-deriving the name map the boundary refuses to expose.
   * The COUNT of first-party doors is the thing that drifts, and it is comparable.
   * (My first version of this test asserted `board.services`, a shape the board
   * does not return. Its control caught it rather than the comparison, which is
   * the only reason it did not pass vacuously.)
   */
  const tokendoors = require('./engine/tokendoors');
  const metered = new Set(Object.values(tokendoors.routes()));

  const board = await (await fetch(base + '/api/connections')).json();
  const agent = await (await fetch(base + '/api/agent/connections')).json();

  const boardRoutes = Object.keys(board.doors || {});
  const agentNames = (agent.services || []).map((s) => s.name);
  const boardFirstParty = boardRoutes.filter((r) => !metered.has(r));

  // CONTROLS. Without these the comparison passes when both sides are empty,
  // which is the outcome it is least able to tell apart from agreement.
  assert.ok(boardRoutes.length > 0, 'control: the board returned no doors at all');
  assert.ok(agentNames.length > 0, 'control: the agent view returned no doors at all');
  assert.ok(metered.size > 0, 'control: no token doors defined, so the subtraction is a no-op');
  assert.ok(boardFirstParty.length < boardRoutes.length,
    'control: nothing was subtracted, so this would pass even if the agent swept metered doors');

  assert.equal(agentNames.length, boardFirstParty.length,
    `the agent view has ${agentNames.length} first-party doors and the board has `
    + `${boardFirstParty.length} (${boardFirstParty.join(', ')}). A door added to one `
    + 'route and not the other is the drift the plan predicted, and the two sweeps '
    + 'are still separate inline copies.');

  /* The other half, asserted separately so a failure says WHICH way it broke: no
     metered door may reach the agent view. Checked by route on the board side and
     by name on the agent side, because those are the vocabularies each one has. */
  const meteredNames = new Set(Object.keys(tokendoors.routes()));
  for (const n of agentNames) {
    assert.ok(!meteredNames.has(n), `a metered door reached the agent view: ${n}`);
  }
});

test('the agent view carries the first-party doors and NOT the metered ones', async () => {
  /**
   * 🛑 THIS TEST USED TO ASSERT PARITY WITH THE BOARD, AND PARITY WAS THE DEFECT.
   * The board sweeps every token door; each `state()` makes a LIVE AUTHENTICATED
   * request with no cache, and several of those doors are METERED SEARCH APIS the
   * person pays for. The board's sweep is fired by somebody opening the Connect
   * section. THIS route is called by agents, and this branch tells every agent the
   * verb exists, so parity meant an agent poll loop spending somebody's allowance
   * on data this card does not use.
   * ⚠️ So the old assertion pinned the money bug in place: the correct fix
   * turned it red. That is the same shape as a guard cementing a defect, and it
   * happened in a test I wrote to catch drift.
   *
   * The invariant now: the agent view carries the FIRST-PARTY doors, and must NOT
   * grow the token doors back. Both directions fail, which parity could not do.
   */
  const board = await (await fetch(base + '/api/connections')).json();
  const agent = await (await fetch(base + '/api/agent/connections')).json();
  const boardDoors = Object.keys(board.doors || {});
  assert.ok(boardDoors.length > 3,
    'control: the board is not sweeping token doors, so this test cannot tell the two sets apart');

  const names = (agent.services || []).map((s) => s.name).sort();
  assert.deepEqual(names, ['Cloudflare', 'GitHub', 'Vercel'],
    'the agent view no longer carries exactly the three first-party doors: ' + JSON.stringify(names));

  /* 🛑 THE ARM THAT COSTS MONEY IF IT EVER GOES GREEN WRONGLY. A token door
     reappearing here is not a cosmetic drift, it is a live billed request per call. */
  assert.ok(agent.services.length < boardDoors.length,
    'the agent view is sweeping as many doors as the board again, which bills the person per call');
});
