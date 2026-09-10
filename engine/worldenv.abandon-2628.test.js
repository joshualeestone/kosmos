'use strict';
/**
 * #2628: engine/worldenv records the world a boot ABANDONS (the #2528 lockout
 * recovery falls back to the default world when a named world will not come up), so
 * /api/status can surface it and the switcher can tell the user "X could not start"
 * instead of silently landing them on Kosmos 1 with no explanation. It records id,
 * display name, and a timestamp; a healthy boot records nothing.
 *
 *   node --test engine/worldenv.abandon-2628.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-worldenv-abandon-2628-'));

// A fresh env per case (bootstrapWorldEnv mutates it); AGENT_WORKFORCE_HOME points
// every world path at the sandbox.
function envFor(sub) {
  const home = nodePath.join(SANDBOX, sub);
  fs.mkdirSync(home, { recursive: true });
  return { ...process.env, AGENT_WORKFORCE_HOME: home };
}

// Re-require worldenv per case so its module-level abandonedWorld/bootedWorldId do not
// leak between cases (only worldenv holds that state; worlds/worldbootguard state is
// on disk in the sandbox, which envFor isolates).
function freshWorldenv() {
  delete require.cache[require.resolve('./worldenv')];
  return require('./worldenv');
}

test('#2628: a boot that ABANDONS a non-coming-up world records it (id, name, at) and falls back to default', () => {
  const worlds = require('./worlds');
  const guard = require('./worldbootguard');
  const env = envFor('abandon');
  const base = worlds.baseRoot(env);
  const home = worlds.createWorld(base, 'Home');
  worlds.setActiveWorld(base, home.id);
  // Make it abandon-eligible via the never-served fast path: one failed boot, not confirmed.
  guard.recordAttempt(base, home.id);
  assert.equal(guard.shouldAbandon(base, home.id), true, 'control: the world is now abandon-eligible');

  const worldenv = freshWorldenv();
  const before = Date.now();
  worldenv.bootstrapWorldEnv(env);

  assert.equal(worldenv.bootedWorld(), worlds.DEFAULT_ID, 'abandoned -> the board booted the default world');
  const ab = worldenv.lastAbandonedWorld();
  assert.ok(ab, 'lastAbandonedWorld is recorded');
  assert.equal(ab.id, home.id, 'records the abandoned world id');
  assert.equal(ab.name, 'Home', 'records the display name (captured BEFORE the pointer reset to default)');
  assert.equal(typeof ab.at, 'number', 'records a timestamp');
  assert.ok(ab.at >= before, 'the timestamp is from this boot, so a consumer can ignore a stale one');
});

test('#2628: a healthy named-world boot records NO abandon (lastAbandonedWorld stays null)', () => {
  const worlds = require('./worlds');
  const env = envFor('healthy');
  const base = worlds.baseRoot(env);
  const side = worlds.createWorld(base, 'Side');
  worlds.setActiveWorld(base, side.id);

  const worldenv = freshWorldenv();
  worldenv.bootstrapWorldEnv(env);

  assert.equal(worldenv.bootedWorld(), side.id, 'control: it booted the named world, not the default');
  assert.equal(worldenv.lastAbandonedWorld(), null, 'a healthy boot records no abandon');
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
