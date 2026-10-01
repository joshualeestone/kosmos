'use strict';

// #3088: exercise the lock under REAL cross-process concurrency. Spawns N real child
// processes that each trust a DISTINCT folder against ONE shared config, concurrently,
// and asserts every child succeeds AND all N keys survive in the final config.
//
// ⚠️ HONEST SCOPE OF THIS TEST. Without withFileLock, trustFolder is read-modify-write,
// so overlapping writers keep only the last one's copy and the others' keys vanish - the
// lost-update this fix prevents. But that loss is TIMING-DEPENDENT (it needs the read and
// rename windows to actually overlap), so a lock-bypassed run does NOT reliably drop keys
// on every scheduling, which means this test is NOT a guaranteed-red control - it is an
// integration smoke test of the LOCKED path. It reliably catches: the {ok,value} envelope
// not being unwrapped (the child below asserts trustFolder's UNWRAPPED shape - a boolean
// `already` - not merely a truthy `ok`, which the raw envelope would also have), and a
// deadlock or never-release (the children would hang and the test time out). It does NOT
// by itself exercise the parent-dir-mkdir-before-lock path, because the test pre-creates
// the config dir; that create-if-absent behavior is covered by trust.test.js. A
// guaranteed-red lost-update control would need a test seam that delays the inner write to
// force the overlap, which trust.js does not expose; the single-process contract is covered
// by trust.test.js (39/39), and the lock's own stale/steal/release logic by filelock.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawn } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'trust-lock-test-')));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const TRUST = nodePath.join(__dirname, 'trust.js');
const { KEY, canonicalOnDisk } = require('./trust');
const K = (p) => canonicalOnDisk(p).split(nodePath.sep).join('/');

// Child: trust one folder against a shared configDir, create-if-absent (the concurrent
// create-and-merge the lock protects). Seams sandboxed via env; CLAUDE_CONFIG_DIR/CODEX_HOME
// stripped so a leaked real var cannot redirect the write (the a-test-of-the-real-env hazard).
const CHILD = `
  const t = require(process.env.TRUST);
  const r = t.trustFolder(process.env.WORKDIR, { configDir: process.env.CFGDIR, createIfAbsent: true });
  // Exit non-zero unless trustFolder returned its UNWRAPPED success shape. A dropped
  // {ok,value} unwrap (returning withFileLock's envelope verbatim) still has a truthy
  // r.ok, so r.ok alone would pass while the bug shipped; the unwrapped success carries a
  // boolean 'already' that the raw envelope does not, so this check catches a dropped
  // unwrap deterministically (independent of whether the lock was contended).
  // #4804: say why, so a red tells a lock wait ("locked by another writer") from anything else.
  process.stdout.write(JSON.stringify(r));
  process.exit(r && r.ok === true && typeof r.already === 'boolean' ? 0 : 2);
`;

// #4804: the lock's own wait budget (2 s) is a property of the product, not of #3088. On a loaded
// CI runner, twelve Node children queueing on one lock ran past it and exited 2, failing PRs that
// touch nothing here. The children get a generous wait instead, so this test measures what it
// names (the lock serialises, nothing is lost) and not machine load. The budget itself is covered
// by filelock.test.js.
const CHILD_LOCK_WAIT_MS = '30000';

function runChildren(cfgDir, workdirs, extraEnv) {
  const base = { ...process.env, TRUST, CFGDIR: cfgDir, AGENT_WORKFORCE_LOCK_MS: CHILD_LOCK_WAIT_MS };
  delete base.CLAUDE_CONFIG_DIR;
  delete base.CODEX_HOME;
  return Promise.all(workdirs.map((w) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', CHILD], {
      env: { ...base, WORKDIR: w, ...(extraEnv || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    child.on('error', (e) => resolve({ code: -1, out: String(e && e.message) }));
  })));
}

test('#3088: N concurrent trustFolder writes to one config all survive (the lock serializes)', async () => {
  const cfgDir = nodePath.join(SANDBOX, 'cfg');
  fs.mkdirSync(cfgDir, { recursive: true });
  const N = 12;
  const workdirs = [];
  for (let i = 0; i < N; i += 1) {
    const w = nodePath.join(SANDBOX, `w${i}`);
    fs.mkdirSync(w, { recursive: true });
    workdirs.push(w);
  }
  const results = await runChildren(cfgDir, workdirs);
  const failed = results.map((r, i) => ({ i, ...r })).filter((r) => r.code !== 0);
  assert.deepEqual(failed, [], `every child must succeed; ${failed.length} of ${N} did not`);

  const cfg = JSON.parse(fs.readFileSync(nodePath.join(cfgDir, '.claude.json'), 'utf8'));
  const projects = cfg.projects || {};
  const missing = workdirs.filter((w) => !(projects[K(w)] && projects[K(w)][KEY] === true));
  assert.deepEqual(missing.map(K), [],
    `${missing.length} of ${N} concurrent trust writes were lost - the lock did not serialize them`);
});

// #4804 CONTROL: the generous wait above must actually reach the children. Without this, a renamed
// env var would leave them on the 2 s default and the test above would quietly measure load again.
// A live holder keeps the lock past the default wait (and well short of the stale age, so nobody
// steals it): children on the default budget fail and say the lock was busy; children on this
// test's budget (runChildren's own environment, exactly as the test above gets it) wait it out and succeed.
test('#4804 control: a holder past the default wait fails the default budget, not the test budget', async () => {
  const { LOCK_WAIT_MS, LOCK_STALE_MS } = require('./filelock');
  const HOLD_MS = LOCK_WAIT_MS + 1500;
  assert.ok(HOLD_MS < LOCK_STALE_MS, 'the hold must stay short of the stale age, or a child steals the lock');
  const arm = async (name, wait) => {
    const cfgDir = nodePath.join(SANDBOX, `ctl-${name}`);
    fs.mkdirSync(cfgDir, { recursive: true });
    const lock = nodePath.join(cfgDir, '.claude.json.lock');
    fs.mkdirSync(lock);
    const release = new Promise((resolve) => setTimeout(() => { fs.rmSync(lock, { recursive: true, force: true }); resolve(); }, HOLD_MS));
    const workdirs = [0, 1, 2].map((i) => { const w = nodePath.join(cfgDir, `w${i}`); fs.mkdirSync(w); return w; });
    const results = await runChildren(cfgDir, workdirs, wait === undefined ? undefined : { AGENT_WORKFORCE_LOCK_MS: wait });
    await release;
    return results;
  };
  const [dflt, ours] = await Promise.all([arm('default', String(LOCK_WAIT_MS)), arm('test', undefined)]);
  assert.deepEqual(dflt.map((r) => r.code), [2, 2, 2], `on the default wait every child must be refused; got ${JSON.stringify(dflt)}`);
  for (const r of dflt) assert.match(r.out, /locked by another writer/, 'a refused child must say the lock was busy');
  assert.deepEqual(ours.map((r) => r.code), [0, 0, 0], `on the test's wait every child must succeed; got ${JSON.stringify(ours)}`);
});
