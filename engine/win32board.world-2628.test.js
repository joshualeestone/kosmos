'use strict';
/**
 * #2628: a Windows board serving a NAMED world keeps its machine paths -- the logon
 * task's anchor, its claim file, its restart log -- where the LAUNCH put them.
 *
 * Once a named world can boot, process.env carries that world's AGENT_WORKFORCE_DATA,
 * and win32anchor.anchorDir honours it. Without the launch env, the boot's
 * ensureInstalled would copy a runtime under the world and re-register the logon task
 * against it, read the claim file from the world (re-creating a task the person had
 * removed), and a restart from the named world would log into a missing folder
 * (review round 1).
 *
 * This file boots the world the way server.js does (worldenv.bootstrapWorldEnv on
 * process.env, with a named world active in a sandbox registry) and then asks the
 * board module where its machine paths are. It runs in its own process, so the
 * mutated process.env stays here.
 *
 *   node --test engine/win32board.world-2628.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-boardworld-2628-'));
/* A sandbox launch: the machine paths of THIS board live in the sandbox, which is
   also the anchor seam win32board.test.js uses. */
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
delete process.env.KOSMOS_WORLD;
delete process.env.KOSMOS_PRE_WORLD_ROOTS;

const worlds = require('./worlds');
const worldenv = require('./worldenv');
const win32anchor = require('./win32anchor');
const board = require('./win32board');

const HOME = 'C:\\Users\\jo';
const LAUNCH = { ...process.env };
const BASE = worlds.baseRoot(process.env);
const WORLD = worlds.createWorld(BASE, 'probe');
worlds.setActiveWorld(BASE, WORLD.id);
worldenv.bootstrapWorldEnv(process.env);   // what server.js does first, with a named world active

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ } });

test('#2628 CONTROL: the post-world env would move the anchor under the world', () => {
  assert.notEqual(process.env.AGENT_WORKFORCE_DATA, LAUNCH.AGENT_WORKFORCE_DATA, 'sanity: the world moved process.env');
  assert.notEqual(win32anchor.anchorDir('win32', HOME, process.env), win32anchor.anchorDir('win32', HOME, LAUNCH),
    'without the launch env, the board\'s machine paths would follow the world');
});

test('#2628 worldenv keeps the environment exactly as launched', () => {
  const launch = worldenv.launchEnv();
  assert.ok(launch, 'captured at boot');
  assert.equal(launch.AGENT_WORKFORCE_DATA, LAUNCH.AGENT_WORKFORCE_DATA);
  assert.ok(Object.isFrozen(launch), 'nobody can move it after the fact');
});

test('#2628 the claim file -- and so "you removed it, leave it alone" -- lives where the LAUNCH put it', () => {
  /* claim/claimed read and write the board's anchor dir, the same dir the shim and
     the restart log use. Asserted on the platform this runs on, so the directories
     are real on a Mac and on Windows. */
  const opts = { platform: process.platform, home: os.homedir() };
  const launchDir = win32anchor.anchorDir(process.platform, os.homedir(), LAUNCH);
  const worldDir = win32anchor.anchorDir(process.platform, os.homedir(), process.env);
  assert.notEqual(launchDir, worldDir, 'sanity: the two candidates differ');
  fs.mkdirSync(launchDir, { recursive: true });
  board.claim(opts);
  assert.ok(fs.existsSync(path.join(launchDir, board.CLAIM_NAME)), 'the claim is written into the launch anchor');
  assert.ok(!fs.existsSync(path.join(worldDir, board.CLAIM_NAME)), 'and never into the world');
  assert.equal(board.claimed(opts), true, 'and it is read back from there');
});

test('#2628 install anchors the logon task from the launch env, never the world\'s', () => {
  let seen = null;
  board.setAnchorer((spec) => { seen = spec; return { ok: false, because: 'stop before registering anything' }; });
  try {
    const r = board.install({ node: 'C:\\n\\node.exe', engineDir: 'C:\\e' });
    assert.equal(r.ok, false, 'sanity: the stub stopped it before any registration');
  } finally { board.setAnchorer(null); }
  assert.equal(seen.env.AGENT_WORKFORCE_DATA, LAUNCH.AGENT_WORKFORCE_DATA, 'the anchor is given the launch env');
});

test('#2628 an explicit env still wins, as every caller that passes one expects', () => {
  const explicit = { AGENT_WORKFORCE_DATA: path.join(SANDBOX, 'elsewhere') };
  const dir = win32anchor.anchorDir(process.platform, os.homedir(), explicit);
  fs.mkdirSync(dir, { recursive: true });
  board.claim({ platform: process.platform, home: os.homedir(), env: explicit });
  assert.ok(fs.existsSync(path.join(dir, board.CLAIM_NAME)), 'the claim follows the env the caller passed');
});
