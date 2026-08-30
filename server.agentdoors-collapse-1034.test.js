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
  github.state = async () => {
    entries += 1;
    if (gate) await gate;
    return { connected: false };
  };
  return {
    entries: () => entries,
    arm() { gate = new Promise((r) => { release = r; }); },
    release() { if (release) { release(); release = null; } gate = null; },
    restore() { github.state = real; },
  };
}

const hit = () => fetch(base + '/api/agent/connections').then((r) => r.json());

test('#1618: two agents asking at once sweep the first-party doors ONCE', async () => {
  const g = countedGithub();
  try {
    /* Ungated warm-up, so a stub that is never reached cannot make the counter
       below read zero and pass vacuously. */
    await hit();
    const warm = g.entries();
    assert.ok(warm >= 1, 'the route never reached the github door, so the counter measures nothing');

    g.arm();
    const a = hit();
    const b = hit();
    await new Promise((r) => setTimeout(r, 150));
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
