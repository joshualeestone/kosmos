'use strict';
/**
 * kosmos#5418: a test process never gets this machine's real data root. Each arm runs a child
 * node with a controlled environment and only reads store.ROOT (nothing is written; the legacy
 * migration is off in every arm).
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
const realRoot = () => require('./store').dataRootFor(process.platform, os.userInfo().homedir, { APPDATA: process.env.APPDATA });

function runJs(src, extra) {
  const r = spawnSync(process.execPath, ['-e', 'const s = require(' + JSON.stringify(STORE) + '); ' + src], { env: childEnv(extra), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /MaxListenersExceeded/, r.stderr);
  return JSON.parse(r.stdout);
}
const within = (p, dir) => { const rel = path.relative(dir, p); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
const underTmp = (p) => within(p, os.tmpdir()) || within(p, fs.realpathSync(os.tmpdir()));

for (const [label, marker] of [['node --test (NODE_TEST_CONTEXT)', { NODE_TEST_CONTEXT: 'child-v8' }], ['tools/run-tests.sh (KOSMOS_TEST_RUN=1)', { KOSMOS_TEST_RUN: '1' }]]) {
  test('#5418: a ' + label + ' process with no sandbox gets a throwaway store root, never the real one, and no variable is set', () => {
    const { root, home } = runJs('process.stdout.write(JSON.stringify({ root: s.ROOT, home: process.env.AGENT_WORKFORCE_HOME ?? null }))', marker);
    assert.notEqual(root, realRoot());
    assert.ok(root.includes(require('./store').TEST_HOME_PREFIX) && underTmp(root), root);
    assert.equal(home, null, 'the throwaway leaked into the environment, where other seams read it');
  });
}

test('#5418: one throwaway root per process, however many reads, with one exit listener; removed at exit', () => {
  const { roots, listeners, root } = runJs('const seen = new Set(); for (let i = 0; i < 15; i++) seen.add(s.ROOT);'
    + ' process.stdout.write(JSON.stringify({ roots: seen.size, listeners: process.listenerCount("exit"), root: [...seen][0] }))', { NODE_TEST_CONTEXT: 'child-v8' });
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
  const got = runJs('const create = require(' + JSON.stringify(path.join(dir, 'create.js')) + '); const worlds = require(' + JSON.stringify(path.join(dir, 'worlds.js')) + ');'
    + ' process.stdout.write(JSON.stringify({ root: s.ROOT, support: create.supportDir(), base: worlds.baseRoot() }))', { NODE_TEST_CONTEXT: 'child-v8' });
  assert.ok(got.root.includes(require('./store').TEST_HOME_PREFIX), got.root);
  assert.equal(got.support, got.root);
  assert.equal(got.base, got.root);
});

test('#5418: a sandbox variable aimed INSIDE the real root (a named world under it) is refused', () => {
  const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: path.join(realRoot(), 'worlds', 'w5418') });
  assert.match(out, /^THREW=store: a test process resolved this machine's REAL data root/, out);
});

test('#5418: a sandbox variable that still points at the real store is refused by name', () => {
  const realParent = path.dirname(realRoot());
  const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: realParent });
  assert.match(out, /^THREW=store: a test process resolved this machine's REAL data root/, out);
  assert.match(out, /#5418/);
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

test('#5418: the real home reached through a symlink is still the real root, and refused', { skip: process.platform === 'win32' && 'a directory symlink needs Developer Mode on Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-link-'));
  const link = path.join(dir, 'home');
  try {
    fs.symlinkSync(os.userInfo().homedir, link);
    assert.match(rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_HOME: link }), /^THREW=/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5418 control: outside a test process the real root is returned as before', () => {
  assert.equal(rootIn({}), 'ROOT=' + realRoot());
});

test('#5418 control: KOSMOS_ALLOW_REAL_ROOT=1 lets a test process read the real root on purpose', () => {
  assert.equal(rootIn({ NODE_TEST_CONTEXT: 'child-v8', KOSMOS_ALLOW_REAL_ROOT: '1' }), 'ROOT=' + realRoot());
});
