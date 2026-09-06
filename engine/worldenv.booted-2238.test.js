'use strict';
/**
 * #2238: engine/worldenv captures the world the board BOOTED into, and that value
 * must NOT move when the registry pointer is later flipped by POST
 * /api/worlds/active. This is the property the world-switch reconnect poll on
 * /api/status depends on: without it, the poll would false-succeed the instant the
 * pointer flips (before the board restarts), reloading onto a board still serving
 * the OLD world.
 *
 *   node --test engine/worldenv.booted-2238.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-worldenv-booted-2238-'));

const worlds = require('./worlds');
const worldenv = require('./worldenv');

// A fresh env per case (bootstrapWorldEnv mutates it with AGENT_WORKFORCE_DATA
// overrides); AGENT_WORKFORCE_HOME points every world path at the sandbox.
function envFor(sub) {
  const home = nodePath.join(SANDBOX, sub);
  fs.mkdirSync(home, { recursive: true });
  return { ...process.env, AGENT_WORKFORCE_HOME: home };
}

test('bootedWorld is the world active AT BOOT, and does NOT follow a later registry flip', () => {
  const env = envFor('named');
  const base = worlds.baseRoot(env);
  const side = worlds.createWorld(base, 'Side Project');   // a named world
  worlds.setActiveWorld(base, side.id);                    // it is active when the board boots

  worldenv.bootstrapWorldEnv(env);                         // <- the boot
  assert.equal(worldenv.bootedWorld(), side.id, 'booted into the active named world');

  // Now flip the registry pointer, exactly as POST /api/worlds/active does.
  worlds.setActiveWorld(base, worlds.DEFAULT_ID);
  assert.equal(worlds.activeWorld(base).id, worlds.DEFAULT_ID, 'control: the REGISTRY pointer flipped');
  assert.equal(worldenv.bootedWorld(), side.id,
    'the booted world MUST stay the boot value, not follow the flipped pointer (the false-success guard)');
});

test('a default-world boot reports the default id', () => {
  const env = envFor('default');                          // no createWorld -> default world
  worldenv.bootstrapWorldEnv(env);
  assert.equal(worldenv.bootedWorld(), worlds.DEFAULT_ID);
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
