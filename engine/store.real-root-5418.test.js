'use strict';
/**
 * kosmos#5418: a test process never gets this machine's real data root. Each arm runs a child
 * node with a controlled environment and reads store.ROOT; the legacy migration is off in every
 * arm. A child that makes a throwaway also sweeps dead-pid throwaways from the temp folder, as
 * every test process does (sweepDeadTestHomes); nothing else is written outside its own scratch.
 *
 *   node --test engine/store.real-root-5418.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STORE = path.join(__dirname, 'store.js');
/* Whether this machine lets this process make a directory symlink (Windows needs Developer Mode or admin). */
const CAN_SYMLINK = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-probe-'));
  try { fs.mkdirSync(path.join(d, 't')); fs.symlinkSync(path.join(d, 't'), path.join(d, 'l'), 'dir'); return true; }
  catch { return false; }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
})();
const SANDBOX_VARS = ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_HOME', 'NODE_TEST_CONTEXT', 'KOSMOS_TEST_RUN', 'KOSMOS_ALLOW_REAL_ROOT'];

/* A child's env: no sandbox and no test marker unless the arm adds them, the real HOME, and no
   legacy migration, so a child only ever READS a path. */
function childEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of SANDBOX_VARS) delete env[k];
  Object.assign(env, { HOME: os.userInfo().homedir, KOSMOS_NO_LEGACY_MIGRATION: '1' }, extra);
  return env;
}
function rootIn(extra) {
  const r = spawnSync(process.execPath, ['-e', 'try { process.stdout.write("ROOT=" + require(' + JSON.stringify(STORE) + ').ROOT) } catch (e) { process.stdout.write("THREW=" + e.message) }'], { env: childEnv(extra), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const realRoot = () => require('./store').realDefaultRoot(process.platform);   // the product's own definition

function runJs(src, extra) {
  const r = spawnSync(process.execPath, ['-e', 'const s = require(' + JSON.stringify(STORE) + '); ' + src], { env: childEnv(extra), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /MaxListenersExceeded/, r.stderr);
  return JSON.parse(r.stdout);
}
const within = (p, dir) => { const rel = path.relative(dir, p); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
const underTmp = (p) => within(p, os.tmpdir()) || within(p, fs.realpathSync(os.tmpdir()));

/* tools/run-tests.sh's marker: KOSMOS_TEST_RUN names the run's own temp folder, which is the child's. */
const RUN_MARKER = { KOSMOS_TEST_RUN: os.tmpdir() };
for (const [label, marker] of [['node --test (NODE_TEST_CONTEXT)', { NODE_TEST_CONTEXT: 'child-v8' }], ['tools/run-tests.sh (KOSMOS_TEST_RUN = its temp folder)', RUN_MARKER]]) {
  test('#5418: a ' + label + ' process with no sandbox gets a throwaway store root, never the real one, and no variable is set', () => {
    const { root, home } = runJs('process.stdout.write(JSON.stringify({ root: s.ROOT, home: process.env.AGENT_WORKFORCE_HOME ?? null }))', marker);
    assert.notEqual(root, realRoot());
    assert.ok(root.includes(require('./store').TEST_HOME_PREFIX) && underTmp(root), root);
    assert.equal(home, null, 'the throwaway leaked into the environment, where other seams read it');
  });
}

test('#5418: one throwaway root per process, however many reads, with one exit listener; removed at exit', () => {
  const { roots, listeners, root } = runJs('const before = process.listenerCount("exit"); const seen = new Set(); for (let i = 0; i < 15; i++) seen.add(s.ROOT);'
    + ' process.stdout.write(JSON.stringify({ roots: seen.size, listeners: process.listenerCount("exit") - before, root: [...seen][0] }))', { NODE_TEST_CONTEXT: 'child-v8' });
  assert.deepEqual({ roots, listeners }, { roots: 1, listeners: 1 });
  const home = path.dirname(path.dirname(path.dirname(root)));
  assert.ok(path.basename(home).startsWith(require('./store').TEST_HOME_PREFIX), home);
  assert.equal(fs.existsSync(home), false, home + ' was left behind');
});

test('#5418: a test that sets HOME AFTER its first store read is honoured from then on', { skip: process.platform === 'win32' && 'os.homedir() reads USERPROFILE on Windows, not HOME' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-late-'));
  try {
    const { first, later } = runJs('const first = s.ROOT; process.env.HOME = ' + JSON.stringify(tmp) + '; process.stdout.write(JSON.stringify({ first, later: s.ROOT }))', { NODE_TEST_CONTEXT: 'child-v8' });
    assert.ok(first.includes(require('./store').TEST_HOME_PREFIX), first);
    assert.ok(later === path.join(tmp, 'Library', 'Application Support', require('./store').APP) || later === path.join(fs.realpathSync(tmp), 'Library', 'Application Support', require('./store').APP), later);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418: every caller that derives the root agrees: store.ROOT, create.supportDir and worlds.baseRoot answer the same throwaway', () => {
  const dir = path.dirname(STORE);
  const monitor = path.join(dir, '..', 'tools', 'selfreport-silence-monitor.js');
  const got = runJs('const create = require(' + JSON.stringify(path.join(dir, 'create.js')) + '); const worlds = require(' + JSON.stringify(path.join(dir, 'worlds.js')) + ');'
    + ' const m = require(' + JSON.stringify(monitor) + ');'
    + ' process.stdout.write(JSON.stringify({ root: s.ROOT, support: create.supportDir(), base: worlds.baseRoot(), monitor: typeof m.defaultStoreDir === "function" ? m.defaultStoreDir() : null }))', { NODE_TEST_CONTEXT: 'child-v8' });
  assert.ok(got.root.includes(require('./store').TEST_HOME_PREFIX), got.root);
  assert.equal(got.support, got.root);
  assert.equal(got.base, got.root);
  assert.equal(got.monitor, path.join(got.root, 'selfreports'), 'the silence monitor derives the root some other way (or no longer exports defaultStoreDir)');
  if (process.platform !== 'win32') {
    const anchor = runJs('const a = require(' + JSON.stringify(path.join(dir, 'win32anchor.js')) + '); process.stdout.write(JSON.stringify({ root: s.ROOT, anchor: a.anchorDir(process.platform, require("node:os").homedir(), process.env) }))', { NODE_TEST_CONTEXT: 'child-v8' });
    assert.equal(anchor.anchor, path.join(anchor.root, 'runtime'), 'the runtime anchor (inside the data root off Windows) derives the root some other way');
  }
});

const throwaway = (out) => out.startsWith('ROOT=') && out.includes(require('./store').TEST_HOME_PREFIX);

test('#5418: a named world\'s DATA an agent inherits (inside the real root) gets the throwaway, not a refusal', () => {
  const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: path.join(realRoot(), 'worlds', 'w5418') });
  assert.ok(throwaway(out), out);
});

test('#5418: a sandbox variable that still points at the real store gets the throwaway', () => {
  const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: path.dirname(realRoot()) });
  assert.ok(throwaway(out), out);
});

test('#5418: the LEGACY leaf (boardauth\'s old token) is never the real one in a test process', () => {
  const got = runJs('process.stdout.write(JSON.stringify({ legacy: s.resolveDataRoot(process.platform, require("node:os").homedir(), process.env, s.LEGACY_APP) }))', { NODE_TEST_CONTEXT: 'child-v8' });
  const realLegacy = require('./store').realDefaultRoot(process.platform, require('./store').LEGACY_APP);
  assert.notEqual(got.legacy, realLegacy);
  assert.ok(got.legacy.includes(require('./store').TEST_HOME_PREFIX), got.legacy);
  assert.equal(path.basename(got.legacy), require('./store').LEGACY_APP, 'the throwaway is not the legacy leaf: ' + got.legacy);
  /* The behaviour that matters is boardauth reading its old token through this, not around it. Pinned in
     source: proving it by behaviour would need a token planted in the real legacy folder. */
  const src = fs.readFileSync(path.join(__dirname, 'boardauth.js'), 'utf8');
  const at = src.indexOf('function legacyTokenPath()');
  const body = src.slice(at, src.indexOf('\n}', at) + 2);
  assert.match(body, /store\.resolveDataRoot\(process\.platform, home, process\.env, store\.LEGACY_APP\)/);
  assert.doesNotMatch(body, /store\.dataRootFor\(/);
});

test('#5418: a sandboxed test process gets its sandbox (AGENT_WORKFORCE_DATA, or AGENT_WORKFORCE_HOME)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-'));
  try {
    assert.equal(rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: tmp }), 'ROOT=' + path.join(tmp, require('./store').APP));
    assert.match(rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_HOME: tmp }), new RegExp('^ROOT=' + tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418: a test that sandboxes by pointing HOME elsewhere keeps ITS sandbox (the real home comes from the user database)', { skip: process.platform === 'win32' && 'os.homedir() reads USERPROFILE on Windows, not HOME' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-home-'));
  try {
    // Inside the HOME sandbox itself, not merely away from the real home: a throwaway home would
    // also avoid the real one, so only this tells the two apart.
    const want = path.join(tmp, 'Library', 'Application Support', require('./store').APP);
    const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', HOME: tmp });
    assert.ok(out === 'ROOT=' + want || out === 'ROOT=' + path.join(fs.realpathSync(tmp), 'Library', 'Application Support', require('./store').APP), out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418: the real home reached through a symlink is still the real root, and gets the throwaway', { skip: !CAN_SYMLINK && 'this machine does not allow a directory symlink here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-link-'));
  const link = path.join(dir, 'home');
  try {
    fs.symlinkSync(os.userInfo().homedir, link);
    const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_HOME: link });
    assert.ok(throwaway(out), out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5418 control: outside a test process the real root is returned as before', () => {
  assert.equal(rootIn({}), 'ROOT=' + realRoot());
});

test('#5418 control: KOSMOS_ALLOW_REAL_ROOT=1 lets a test process read the real root on purpose', () => {
  assert.equal(rootIn({ NODE_TEST_CONTEXT: 'child-v8', KOSMOS_ALLOW_REAL_ROOT: '1' }), 'ROOT=' + realRoot());
});

/* A pid no process has: above the usual range, and checked dead before use. */
function deadPid() {
  for (let p = 4194000; p < 4194300; p++) { try { process.kill(p, 0); } catch (e) { if (e.code === 'ESRCH') return p; } }
  throw new Error('no free pid found for the dead-process arm');
}

test('#5418: sweepDeadTestHomes removes a dead process\'s throwaway and keeps a live one, a malformed name and anything else', () => {
  const store = require('./store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep5418-'));
  try {
    const dpid = deadPid();
    const dead = path.join(tmp, store.TEST_HOME_PREFIX + dpid + '-AAAAAA');
    const unmarked = path.join(tmp, store.TEST_HOME_PREFIX + dpid + '-UUUUUU');   // the name pattern, no marker
    const elsewhere = path.join(tmp, store.TEST_HOME_PREFIX + dpid + '-HHHHHH');  // marked by another host
    // A live process this test started itself, signalled successfully (so the arm proves "live", not EPERM).
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
    process.kill(child.pid, 0);
    const live = path.join(tmp, store.TEST_HOME_PREFIX + child.pid + '-BBBBBB');
    const junk = path.join(tmp, store.TEST_HOME_PREFIX + 'notapid');
    const other = path.join(tmp, 'other-folder');
    for (const d of [dead, live, junk, other, unmarked, elsewhere]) fs.mkdirSync(path.join(d, 'Library'), { recursive: true });
    const mark = (d, pid, host) => fs.writeFileSync(path.join(d, store.TEST_HOME_MARK), JSON.stringify({ pid, host }));
    mark(dead, dpid, os.hostname()); mark(live, child.pid, os.hostname()); mark(elsewhere, dpid, os.hostname() + '-other');
    try { store.sweepDeadTestHomes(tmp); } finally { child.kill(); }
    assert.equal(fs.existsSync(dead), false, 'the dead process\'s throwaway was kept');
    assert.equal(fs.existsSync(unmarked), true, 'a folder with no marker was removed');
    assert.equal(fs.existsSync(elsewhere), true, 'another host\'s throwaway was removed');
    assert.equal(fs.existsSync(live), true, 'a live process\'s throwaway was removed');
    assert.equal(fs.existsSync(junk), true, 'a name with no pid was removed');
    assert.equal(fs.existsSync(other), true, 'a folder outside the prefix was removed');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418: test-support/data-root-sandbox.js and the store agree on what the real root is', () => {
  assert.equal(require('../test-support/data-root-sandbox').realDataRoot(), require('./store').realDefaultRoot(process.platform));
});

test('#5418: a test process that allows the real root to READ it never runs the legacy migration on it', () => {
  /* Pinned in source: proving it by behaviour would mean running the migration against the real store. */
  const src = fs.readFileSync(STORE, 'utf8');
  const at = src.indexOf('function root() {');
  const body = src.slice(at, src.indexOf('\n}', at) + 2);
  const skip = body.search(/env\.KOSMOS_ALLOW_REAL_ROOT\s*===\s*'1'[^;\n]*isRealRoot\(resolved[^;\n]*return resolved/);
  const migrate = body.search(/maybeMigrateLegacyStore\(\)/);
  assert.ok(skip > -1 && migrate > -1 && skip < migrate, 'root() can migrate the real store for a test that only allowed reading it');
});

test('#5418: node --test --test-isolation=none (no NODE_TEST_CONTEXT) is a test process too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-iso-'));
  try {
    const file = path.join(dir, 'probe.test.js');
    fs.writeFileSync(file, "require('node:test')('p', () => { process.stdout.write('ROOT=' + require(" + JSON.stringify(STORE) + ").ROOT + '\\n'); });\n");
    const r = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap', file], { env: childEnv({}), encoding: 'utf8' });
    const line = (r.stdout.split('\n').find((l) => l.startsWith('ROOT=')) || '');
    assert.ok(line, r.stdout + r.stderr);
    assert.ok(line.includes(require('./store').TEST_HOME_PREFIX), line);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5418: a SANDBOX in a test process that also allows the real root still migrates as usual', { skip: process.platform === 'win32' && 'the sandbox below is built with the macOS leaf' }, () => {
  const store = require('./store');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-mig-'));
  try {
    const legacy = path.join(home, 'Library', 'Application Support', store.LEGACY_APP);
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'seed.txt'), 'x');
    const env = childEnv({ NODE_TEST_CONTEXT: 'child-v8', KOSMOS_ALLOW_REAL_ROOT: '1', AGENT_WORKFORCE_HOME: home });
    delete env.KOSMOS_NO_LEGACY_MIGRATION;
    const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(require(' + JSON.stringify(STORE) + ').ROOT)'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, path.join(home, 'Library', 'Application Support', store.APP));
    assert.ok(fs.existsSync(path.join(r.stdout, 'seed.txt')), 'the sandbox was not migrated');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#5418: the sweep never removes or follows a link named like a dead throwaway', { skip: !CAN_SYMLINK && 'this machine does not allow a directory symlink here' }, () => {
  const store = require('./store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep5418-link-'));
  try {
    const dpid = deadPid();
    const target = path.join(tmp, 'link-target');
    fs.mkdirSync(path.join(target, 'keep'), { recursive: true });
    fs.writeFileSync(path.join(target, store.TEST_HOME_MARK), JSON.stringify({ pid: dpid, host: os.hostname() }));
    const link = path.join(tmp, store.TEST_HOME_PREFIX + dpid + '-LLLLLL');
    fs.symlinkSync(target, link, 'dir');
    store.sweepDeadTestHomes(tmp);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'a link was removed');
    assert.ok(fs.existsSync(path.join(target, 'keep')), 'the sweep followed a link into its target');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418 control: KOSMOS_TEST_RUN left in a shell (not the run\'s temp folder) does not make a real board a test', () => {
  for (const value of ['1', path.join(os.tmpdir(), 'not-this-run-5418')]) {
    assert.equal(rootIn({ KOSMOS_TEST_RUN: value }), 'ROOT=' + realRoot(), value);
  }
});

test('#5418: a sandbox variable aimed into the real LEGACY folder gets the throwaway too', () => {
  const store = require('./store');
  const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: store.realDefaultRoot(process.platform, store.LEGACY_APP) });
  assert.ok(throwaway(out), out);
});

test('#5418: asking about another platform never throws and never gets a throwaway (it cannot be this machine\'s root)', () => {
  const other = process.platform === 'win32' ? 'darwin' : 'win32';
  // A home valid for the platform asked about (a Windows home is not an absolute macOS path, and dataRootFor
  // refuses that on its own); off Windows the account's own home is used, as a real caller would.
  const home = other === 'darwin' ? '/Users/' + path.basename(os.userInfo().homedir) : os.userInfo().homedir;
  const got = runJs('process.stdout.write(JSON.stringify({ r: s.resolveDataRoot(' + JSON.stringify(other) + ', ' + JSON.stringify(home) + ', {}) }))', { NODE_TEST_CONTEXT: 'child-v8' });
  assert.ok(!got.r.includes(require('./store').TEST_HOME_PREFIX), got.r);
});

