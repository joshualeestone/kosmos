'use strict';
/**
 * #1618 x #1034: `GET /api/agent/connections` SHARES the first-party door sweep
 * with the board's shelf, and shares it by COLLAPSING rather than by caching.
 *
 * 🛑 WHY THIS FILE EXISTS, AND WHY NO EXISTING TEST COULD HAVE CAUGHT IT.
 * #1618 shipped on main while this branch was open. Main collapsed the shelf;
 * this branch added a SECOND, hand-copied sweep of the same three doors on the
 * route it tells every agent to poll. The merge was textually clean
 * (`git merge-tree` exit 0, no conflicts), both sides' suites were green, and
 * the result was a collapsed sweep and an uncollapsed duplicate of it in one
 * file. Nothing in the toolchain can see that: it is not a conflict, not a
 * syntax error, and not a failing assertion. Only a test that asks how many
 * times the door was actually entered can.
 *
 * ⚠️ THE SECOND TEST IS THE ONE THAT MATTERS. Collapse and cache are
 * indistinguishable from the first test alone, and this card's central
 * invariant is that `cannot tell` is never converted into a confident
 * `not connected`. A time window does exactly that conversion, which is why
 * #1618 records a 5s TTL being built here and killed by the suite in one run
 * with `'none' !== 'unknown'`. So the sequential arm asserts the sweep RE-RUNS
 * once the first has settled. Without it, a reintroduced cache passes.
 *
 *   node --test server.agentdoors-collapse-1034.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentdoors-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const github = require('./engine/github');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* Counts entries into the github door and can be HELD OPEN on demand.
   `server.js` calls `github.state()` off the module object, so replacing the
   property is enough; the gate is armed explicitly so setup never blocks on a
   gate nothing has released. */
function countedGithub() {
  const real = github.state;
  let entries = 0;
  let gate = null;
  let release = null;
  let onEntry = null;
  github.state = async () => {
    entries += 1;
    if (onEntry) { const fire = onEntry; onEntry = null; fire(); }
    if (gate) await gate;
    return { connected: false };
  };
  return {
    entries: () => entries,
    /* Resolves at the NEXT entry into the door. The collapse assertions used to
       sleep a fixed 150ms and read the counter; under the load this box runs
       suites at (15-21) the first request can still be short of the door, the
       count reads 0, and a test that gates a cut goes red with no defect. */
    nextEntry: () => new Promise((r) => { onEntry = r; }),
    arm() { gate = new Promise((r) => { release = r; }); },
    release() { if (release) { release(); release = null; } gate = null; },
    restore() { github.state = real; },
  };
}

const hit = () => fetch(base + '/api/agent/connections').then((r) => r.json());

/* Resolves when the board's HTTP server has RECEIVED a request for `pathname`,
   then yields twice so its handler can run to the sweep call. Registered before
   the request is fired, so it cannot miss it. This is the second caller's
   arrival: without it, "swept once" is vacuous for a caller that has not arrived. */
function arrival(pathname) {
  return new Promise((resolve) => {
    const on = (req) => {
      if ((req.url || '').split('?')[0] !== pathname) return;
      server.off('request', on);
      setImmediate(() => setImmediate(resolve));
    };
    server.on('request', on);
  });
}

test('#1618: two agents asking at once sweep the first-party doors ONCE', async () => {
  const g = countedGithub();
  try {
    /* Ungated warm-up, so a stub that is never reached cannot make the counter
       below read zero and pass vacuously. */
    await hit();
    const warm = g.entries();
    assert.ok(warm >= 1, 'the route never reached the github door, so the counter measures nothing');

    g.arm();
    const entered = g.nextEntry();
    const a = hit();
    await entered;                                   // a is inside the door, held open
    const arrivedB = arrival('/api/agent/connections');
    const b = hit();
    await arrivedB;                                  // b has reached the route
    const during = g.entries() - warm;
    assert.equal(during, 1,
      `the route swept the github door ${during} times for two concurrent agents, so the sweep was not shared`);

    g.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual(Object.keys(ra).sort(), Object.keys(rb).sort(),
      'the two agents were handed different shapes');
  } finally {
    g.release();
    g.restore();
  }
});

test('#1618: the BOARD SHELF and the AGENT ROUTE share one sweep, which is why the builder exists', async () => {
  /**
   * 🛑 THIS IS THE HEADLINE PROPERTY OF `readFirstPartyDoors`, AND IT WAS THE ONE
   * THING NOT PINNED. The function's own header spends thirty lines arguing it
   * exists so the board shelf and this route cannot drift and cannot double-sweep.
   * Every other test in this file fires `/api/agent/connections` TWICE, and the two
   * tests elsewhere that touch both routes fetch them SEQUENTIALLY, which cannot
   * observe collapse at all.
   *
   * ⇒ A refactor handing the agent route its own private `inflight.collapse` would
   * satisfy every existing assertion while destroying the property the extraction
   * was made for. The duplication it replaced was invisible to two green suites
   * once already; this is the guard that stops it returning.
   */
  const g = countedGithub();
  try {
    await hit();
    const warm = g.entries();
    assert.ok(warm >= 1, 'the agent route never reached the github door, so the counter below measures nothing');

    g.arm();
    const entered = g.nextEntry();
    const agent = hit();
    await entered;                                   // the agent route is inside the door, held open
    const arrivedBoard = arrival('/api/connections');
    const board = fetch(base + '/api/connections').then((r) => r.json());
    await arrivedBoard;                              // the board route has arrived
    const during = g.entries() - warm;
    assert.equal(during, 1,
      `the two routes swept the github door ${during} times between them, so they are NOT sharing one in-flight sweep and can drift apart`);

    g.release();
    const [a, b] = await Promise.all([agent, board]);
    assert.ok(a && typeof a === 'object', 'the agent route returned no object');
    assert.ok(b && b.doors, 'the board shelf returned no doors');
  } finally {
    g.release();
    g.restore();
  }
});

test('#1618: a later ask is FRESH, not served from a window', async () => {
  /**
   * The collapse holds the promise only while it is unsettled. If anyone ever
   * puts a TTL back, this goes red and the one above stays green -- which is
   * the whole reason both exist.
   */
  const g = countedGithub();
  try {
    await hit();
    const first = g.entries();
    assert.ok(first >= 1, 'the route never reached the github door, so this test cannot see a second sweep');
    await hit();
    assert.ok(g.entries() > first,
      'the second ask reused the first answer, so a time window was reintroduced and `cannot tell` can now go stale as `not connected`');
  } finally {
    g.restore();
  }
});
