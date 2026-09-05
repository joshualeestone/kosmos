'use strict';
/*
 * #1704 slice 2b-i: engine/worldenv.bootstrapWorldEnv applies the ACTIVE world's
 * data-root env BEFORE any engine module is required, so the ~26 modules that
 * freeze store.ROOT at REQUIRE time capture the ACTIVE world's root -- not the
 * default -- when the board boots into a named world.
 *
 * The freeze happens once, at module load, and node caches modules per process,
 * so require-BEFORE vs require-AFTER the bootstrap can only be compared across
 * separate processes. Each arm therefore runs in a child `node` that re-requires
 * a set of REAL frozen modules (commitments/activity/limits/attachments -- each a
 * `const ... = ...store.ROOT...` captured at load, each exporting that frozen path)
 * and prints where they resolved. A hand-rolled probe module would answer a
 * different question; these are the production modules.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const worlds = require('./worlds');
const worldenv = require('./worldenv');

const ENGINE_DIR = __dirname;

/* Build a sandbox with a registry: default + a named world 'alpha'. `active`
   picks the activeWorldId. Returns { data, base } where `data` is the value for
   AGENT_WORKFORCE_DATA and `base` is the world-independent registry base. */
function makeSandbox(active) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'worldenv-2b-'));
  const base = worlds.baseRoot({ AGENT_WORKFORCE_DATA: data });
  worlds.createWorld(base, 'alpha'); // creates base/worlds/alpha subtrees + registry
  if (active === 'alpha') worlds.setActiveWorld(base, 'alpha');
  return { data, base };
}

/* Run the frozen-module probe in a fresh process. `order` is 'after' (bootstrap
   then require -- the fix) or 'before' (require then bootstrap -- 2a's late apply,
   the bug). Returns the parsed { commitmentsDIR, activityDIR, limitsFILE,
   attachmentsROOT, storeROOT }. */
function probe(data, order) {
  const script = `
    const eng = process.env.KOSMOS_ENGINE_DIR;
    function read() {
      const c = require(eng + '/commitments');
      const a = require(eng + '/activity');
      const l = require(eng + '/limits');
      const at = require(eng + '/attachments');
      const s = require(eng + '/store');
      return { commitmentsDIR: c.DIR, activityDIR: a.DIR, limitsFILE: l.FILE, attachmentsROOT: at.ROOT, storeROOT: s.ROOT };
    }
    let out;
    if (process.env.KOSMOS_PROBE_ORDER === 'before') {
      out = read();                                                   // freeze at the default root
      require(eng + '/worldenv').bootstrapWorldEnv(process.env);      // ... apply too late
    } else {
      require(eng + '/worldenv').bootstrapWorldEnv(process.env);      // apply first
      out = read();                                                   // ... then freeze at the active root
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const res = spawnSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      AGENT_WORKFORCE_DATA: data,
      AGENT_WORKFORCE_HOME: data,
      KOSMOS_ENGINE_DIR: ENGINE_DIR,
      KOSMOS_PROBE_ORDER: order,
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `probe child failed (order=${order}): ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('FIX: booting into a named world, require-time-frozen modules resolve to that world', () => {
  const { data, base } = makeSandbox('alpha');
  const alphaRoot = path.join(base, 'worlds', 'alpha', 'AgentWorkforce');
  const got = probe(data, 'after');
  assert.equal(got.storeROOT, alphaRoot, 'store.ROOT follows the active world');
  assert.equal(got.commitmentsDIR, path.join(alphaRoot, 'commitments'), 'commitments (const BASE = store.ROOT) follows');
  assert.equal(got.activityDIR, path.join(alphaRoot, 'activity'), 'activity (const DIR = path.join(store.ROOT,...)) follows');
  assert.equal(got.limitsFILE, path.join(alphaRoot, 'limits.json'), 'limits follows');
  assert.equal(got.attachmentsROOT, path.join(alphaRoot, 'attachments'), 'attachments follows');
});

test('CONTROL: the default world moves NOTHING (no false relocation)', () => {
  const { data, base } = makeSandbox('default');
  const got = probe(data, 'after');
  assert.equal(got.storeROOT, base, 'default world = legacy root, unchanged');
  assert.equal(got.commitmentsDIR, path.join(base, 'commitments'), 'commitments stays at the legacy root');
  assert.equal(got.activityDIR, path.join(base, 'activity'), 'activity stays');
  // The control is aimed at the exact arm under test: it proves the probe CAN
  // report the default root, so the FIX test's alpha result is a real move.
  assert.notEqual(got.commitmentsDIR, path.join(base, 'worlds', 'alpha', 'AgentWorkforce', 'commitments'));
});

test('PERTURBATION: applying the env AFTER the freeze (2a\'s bug) leaves modules on the default root', () => {
  const { data, base } = makeSandbox('alpha'); // alpha IS active
  const got = probe(data, 'before');            // ... but the modules froze before the bootstrap
  // This is exactly the cross-world bleed 2b-i fixes: alpha active, yet the frozen
  // modules serve the DEFAULT world's files. Proves ordering is load-bearing.
  assert.equal(got.storeROOT, base, 'store.ROOT read live sees the default (no override applied yet at freeze)');
  assert.equal(got.commitmentsDIR, path.join(base, 'commitments'), 'BLEED: commitments frozen at default while alpha is active');
  assert.notEqual(got.commitmentsDIR, path.join(base, 'worlds', 'alpha', 'AgentWorkforce', 'commitments'));
});

test('fail-open: a broken env (non-absolute AGENT_WORKFORCE_DATA) returns null, never throws', () => {
  let base;
  assert.doesNotThrow(() => { base = worldenv.bootstrapWorldEnv({ AGENT_WORKFORCE_DATA: 'relative/not/absolute' }); });
  assert.equal(base, null, 'a broken login env boots as the default world, unchanged');
});
