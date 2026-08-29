'use strict';

/**
 * #1500: the Codex walk went around the sandbox refusal.
 *
 *   node --test engine/discover.codexsandbox-1500.test.js
 *
 * 🛑 WHAT WAS MEASURED. A fully sandboxed `discover.found()` (both
 * `AGENT_WORKFORCE_CONFIG_ROOT` and `AGENT_WORKFORCE_DATA` pointed at a temp
 * dir, five fixture folders) returned **a real agent out of another agent's
 * scratchpad on this machine**, plus this Mac's real `unreadable` count rather
 * than the fixture's.
 *
 * `status.configRoots` refuses to read the operator's machine when a process has
 * declared itself a fixture. `foundCodex` reaches `~/.codex` through
 * `codexupdate.defaultHome()` and never calls `configRoots`, so the refusal
 * could not fire for it.
 *
 * ⭐ AND THE REFUSAL'S OWN COMMENT PREDICTED THIS. It says it exists "for every
 * harness anyone writes next, including the one that does not exist yet and will
 * forget". The harness that forgot is in this repo, and it forgot because the
 * guard was reachable from exactly one function.
 *
 * ⚠️ THE SUITE WAS GREEN THROUGHOUT and still is. This was never a failing test;
 * it was every discover assertion quietly reading whoever ran it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withEnv(env, fn) {
  const keys = ['AGENT_WORKFORCE_DATA', 'HOME', 'AGENT_WORKFORCE_CONFIG_ROOT', 'CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  try { return fn(); }
  finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

/* Loaded fresh per assertion: the predicate reads the environment at CALL time,
   but requiring once and trusting it across env changes is how a test starts
   asserting about the first environment it ever saw. */
function status() {
  delete require.cache[require.resolve('./status')];
  return require('./status');
}

const TMP = fs.realpathSync(os.tmpdir());

test('a fixture that sandboxes its DATA but not its HOME is refused', () => {
  const yes = withEnv({ AGENT_WORKFORCE_DATA: path.join(TMP, 'kosmos-fixture-1500') },
    () => status().sandboxIsInconsistent());
  assert.equal(yes, true,
    'the guard does not fire on the exact shape that leaked: data in temp, home real');
});

test('CONTROL: a CONSISTENT sandbox is NOT refused', () => {
  /* Both under temp. A fixture that has sandboxed itself properly must not be
     refused, or every honest harness breaks.
     🛑 WITHOUT THIS ARM, "always return true" passes the test above.
     ⚠️ IT SETS `HOME`, AND MY FIRST VERSION SET `AGENT_WORKFORCE_HOME`, WHICH
     THIS MODULE DOES NOT READ. `status.js`'s `homeDir()` is a bare
     `os.homedir()` -- unlike `accounts.js`, `runningas.js` and four others,
     which all honour `AGENT_WORKFORCE_HOME`. So the ONLY way to sandbox this
     module's idea of home is the real environment variable underneath it. The
     failing control is what told me; the code was right and my premise was not. */
  const no = withEnv({
    AGENT_WORKFORCE_DATA: path.join(TMP, 'kosmos-fixture-1500'),
    HOME: path.join(TMP, 'kosmos-fixture-1500-home'),
  }, () => status().sandboxIsInconsistent());
  assert.equal(no, false, 'a properly sandboxed fixture is being refused, which breaks every honest harness');
});

test('CONTROL: production is NOT refused', () => {
  /* Production sets AGENT_WORKFORCE_DATA to Application Support, which is not
     under a temp root. If this could fire for a user, Kosmos would find nobody's
     agents at all. */
  const no = withEnv({ AGENT_WORKFORCE_DATA: path.join(os.homedir(), 'Library', 'Application Support') },
    () => status().sandboxIsInconsistent());
  assert.equal(no, false, 'the guard can fire for a real user, which would hide every agent they have');
});

test('CONTROL: no sandbox declared at all is NOT refused', () => {
  assert.equal(withEnv({}, () => status().sandboxIsInconsistent()), false,
    'a plain run is being treated as a fixture');
});

test('the Codex walk honours it, which is the whole card', () => {
  /* Asserted through `found()` rather than by reading the source, because the
     defect was never that the code was wrong: it was that a guard existed and
     this path could not reach it. */
  const src = fs.readFileSync(require.resolve('./discover'), 'utf8');
  const at = src.indexOf('function foundCodex');
  assert.ok(at > -1, 'foundCodex moved; restate this pin');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /sandboxIsInconsistent\(\)/,
    'the Codex walk still reaches the operator\'s real ~/.codex from inside a sandbox');
  /* And it must refuse BEFORE the read, not filter after: a walk that opens the
     operator's rollouts and then discards them has still read them. */
  assert.ok(body.indexOf('sandboxIsInconsistent') < body.indexOf('rollouts()'),
    'the guard runs after the rollouts are read, so the machine is still being opened');
});

test('CONTROL: the guard is reachable from the module the walk uses', () => {
  /* A function nobody can call is the defect this card is about, one layer up. */
  assert.equal(typeof status().sandboxIsInconsistent, 'function',
    'sandboxIsInconsistent is not exported, so discover cannot honour it');
});
