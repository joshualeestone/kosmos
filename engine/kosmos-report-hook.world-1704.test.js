'use strict';
/**
 * #1704 PR2 (plan §5): the Windows report hook names this agent's Kosmos on every
 * report, and a board serving ANOTHER Kosmos (421 wrongWorld) is neither kept
 * nor announced: a report is stale by the time its Kosmos opens, and "reporting
 * is OFF" would be false (this agent's own Kosmos is simply not the one open).
 *
 *   node --test engine/kosmos-report-hook.world-1704.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root BEFORE any require, so the outbox this proves stays
// empty is a sandbox one and the hook's board-token read is hermetic.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hook-world-1704-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const hook = require('./kosmos-report-hook');
const outbox = require('./outbox');
const { WORLD_HEADER } = require('./launchidentity');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

/* A fetch that answers every POST with `status` and `body`, recording the call. */
function answering(status, body, seen) {
  return async (url, init) => {
    seen.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
}

/* SessionStart (startup) is the one LOUD event: a delivery failure there prints a
   systemMessage, so it is the event whose silence on a 421 means something. */
function sessionStart(extra) {
  return {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
    url: 'http://127.0.0.1:1',
    boardToken: null,
    throttleDir: path.join(SANDBOX, 'throttle'),
    now: () => 1000,
    ppid: 4242,
    ...extra,
  };
}

test('every report names this agent\'s Kosmos: KOSMOS_WORLD, or default when it is absent', async () => {
  const named = [];
  await hook.main(sessionStart({ env: { KOSMOS_WORLD: 'test' }, fetchImpl: answering(200, { recorded: true }, named), stdout: () => {} }));
  assert.equal(named.length, 1);
  assert.equal(named[0].init.headers[WORLD_HEADER], 'test');

  const plain = [];
  await hook.main(sessionStart({ env: {}, fetchImpl: answering(200, { recorded: true }, plain), stdout: () => {} }));
  assert.equal(plain[0].init.headers[WORLD_HEADER], 'default', 'an agent with no KOSMOS_WORLD is in the default world and must say so');
});

test('a 421 on the loud SessionStart is silent and keeps nothing; a 500 on the same event still speaks', async () => {
  const printed = [];
  const code = await hook.main(sessionStart({
    env: { KOSMOS_WORLD: 'test' },
    fetchImpl: answering(421, { wrongWorld: true, serving: 'default', because: 'another Kosmos is open' }, []),
    stdout: (s) => printed.push(s),
  }));
  assert.equal(code, 0);
  assert.deepEqual(printed, [], 'a Kosmos that is not open is not "reporting is OFF"');
  assert.deepEqual(outbox.list(), [], 'a report is never kept for later: it would be stale');

  /* The control: without it, a hook that printed nothing on ANY failure would
     pass the assertion above. */
  const control = [];
  await hook.main(sessionStart({ env: {}, fetchImpl: answering(500, { error: 'the board broke' }, []), stdout: (s) => control.push(s) }));
  assert.equal(control.length, 1);
  assert.match(control[0], /reporting is OFF/);
});
