'use strict';

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits

/**
 * #7554 (follow-ups to #1760): ensure() looks the data root up per the environment inputs that decide it, rather than
 * resolving it on every write; and a transient chmod failure (EBUSY) is tried again, while a lasting one (EPERM) is not
 * retried by ensure() but still is by the board's start call. POSIX modes only, so the mode tests skip on Windows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ensurecost-7554-')));
process.env.AGENT_WORKFORCE_DATA = SB;
delete process.env.AGENT_WORKFORCE_HOME;
test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* temp */ } });

const store = require('./store');
const SRC = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8');
const skip = process.platform === 'win32';
const modeOf = (p) => fs.statSync(p).mode & 0o777;

/* A fresh data folder whose root exists at 0755, so no earlier write in this process has tried it. */
function looseRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensurecost-7554-' + tag + '-'));
  process.env.AGENT_WORKFORCE_DATA = dir;
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.chmodSync(store.ROOT, 0o755);
  assert.equal(modeOf(store.ROOT), 0o755, 'precondition: the root starts at 0755');
  return { dir, root: store.ROOT };
}
function write(dir, name) { store.writeProfile(name, { dir: path.join(dir, 'work', name), provider: 'anthropic' }); }
/* fs.chmodSync replaced for `root` only, for the length of `fn`; every other path is the real call. */
function withChmod(root, impl, fn) {
  const real = fs.chmodSync;
  let calls = 0;
  fs.chmodSync = function (p, mode) {
    if (path.resolve(String(p)) === path.resolve(root)) { calls += 1; return impl(real, p, mode, calls); }
    return real.apply(this, arguments);
  };
  try { fn(); } finally { fs.chmodSync = real; }
  return calls;
}

test('#7554: every environment input the data root depends on is in the cache key (a missing one would reuse a stale root)', () => {
  const list = SRC.match(/const ROOT_ENV_INPUTS = \[([^\]]*)\]/);
  assert.ok(list, 'ROOT_ENV_INPUTS is gone, so this audit reads nothing');
  const inputs = new Set([...list[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1]));
  const body = (name) => {
    const at = SRC.indexOf('\nfunction ' + name + '(');
    assert.ok(at >= 0, 'premise: store.js has ' + name);
    const next = SRC.indexOf('\nfunction ', at + 1);
    return SRC.slice(at, next < 0 ? undefined : next);
  };
  const read = new Set();
  for (const fn of ['dataRootFor', 'resolveDataRoot', 'currentDataRoot', 'isTestProcess', 'inThisTestRun', 'isRealRootInTests']) {
    const b = body(fn);
    for (const m of b.matchAll(/\b(?:e|env|process\.env)\.([A-Z_][A-Z0-9_]*)/g)) read.add(m[1]);
    if (/os\.homedir\(\)/.test(b)) { read.add('HOME'); read.add('USERPROFILE'); }
    // Review 2: os.tmpdir() falls back to SystemRoot / windir on Windows when TEMP and TMP are unset.
    if (/os\.tmpdir\(\)/.test(b)) { for (const v of ['TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'windir']) read.add(v); }
  }
  // CONTROL: the scan sees the inputs it must (the data override, the home override, the test-run marker).
  for (const must of ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_HOME', 'KOSMOS_TEST_RUN']) assert.ok(read.has(must), 'the scan no longer sees ' + must);
  const missing = [...read].filter((v) => !inputs.has(v));
  assert.deepEqual(missing, [], 'read by the data root but not in ROOT_ENV_INPUTS');
});

test('#7554: the cached root follows a changed AGENT_WORKFORCE_DATA, so a second data folder is tightened too', { skip }, () => {
  const was = process.env.AGENT_WORKFORCE_DATA;
  try {
    const a = looseRoot('a');
    write(a.dir, 'probea');
    assert.equal(modeOf(a.root), 0o700, 'CONTROL: the first folder was not tightened');
    const b = looseRoot('b');
    write(b.dir, 'probeb');
    assert.equal(modeOf(b.root), 0o700, `a changed data folder reused the first folder's answer (got ${modeOf(b.root).toString(8)})`);
    process.env.AGENT_WORKFORCE_DATA = a.dir;
    fs.chmodSync(a.root, 0o755);
    write(a.dir, 'probea2');
    assert.equal(modeOf(a.root), 0o755, 'CONTROL: a folder already tried is not chmodded again on every write');
  } finally { process.env.AGENT_WORKFORCE_DATA = was; }
});

test('#7554: a transient chmod failure (EBUSY) is tried again on the next write', { skip }, () => {
  const was = process.env.AGENT_WORKFORCE_DATA;
  try {
    const c = looseRoot('busy');
    const calls = withChmod(c.root, (real, p, mode, n) => {
      if (n === 1) throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      return real(p, mode);
    }, () => {
      write(c.dir, 'busy1');
      assert.equal(modeOf(c.root), 0o755, 'precondition: the busy chmod changed nothing');
      write(c.dir, 'busy2');
    });
    assert.equal(calls, 2, 'the root was not tried again after EBUSY');
    assert.equal(modeOf(c.root), 0o700, `the retry did not tighten the root (got ${modeOf(c.root).toString(8)})`);
  } finally { process.env.AGENT_WORKFORCE_DATA = was; }
});

for (const code of ['EPERM', 'EACCES'])
test('#7554: a lasting failure (' + code + ') is not retried by ensure() on every write, but the board start call tries again', { skip }, () => {
  const was = process.env.AGENT_WORKFORCE_DATA;
  try {
    const d = looseRoot('perm-' + code.toLowerCase());
    const calls = withChmod(d.root, () => { throw Object.assign(new Error('not permitted'), { code }); }, () => {
      write(d.dir, 'perm1');
      write(d.dir, 'perm2');
      write(d.dir, 'perm3');
    });
    assert.equal(calls, 1, `ensure() retried a root it cannot change ${calls} times`);
    assert.equal(modeOf(d.root), 0o755, 'precondition: nothing changed the root');
    assert.equal(store.secureRoot(), 0o700, 'the board start call (secureRoot) did not try again once the root could be changed');
  } finally { process.env.AGENT_WORKFORCE_DATA = was; }
});

test('#7554 review 1: ensure() resolves the root once per environment, not once per write (the cache is used)', { skip }, () => {
  const was = process.env.AGENT_WORKFORCE_DATA;
  try {
    const e = looseRoot('cache');
    write(e.dir, 'cache1');
    const after1 = store._ensureRootCacheSizeForTest();
    assert.ok(after1 >= 1, 'premise: the first write under this folder filled the cache');
    for (let i = 2; i <= 6; i += 1) write(e.dir, 'cache' + i);
    assert.equal(store._ensureRootCacheSizeForTest(), after1, 'the same environment added entries: the cache is not keyed as it should be');
    const f = looseRoot('cache2');
    write(f.dir, 'cache7');
    assert.equal(store._ensureRootCacheSizeForTest(), after1 + 1, 'a new data folder did not get its own entry, so ensure() is not using the cache');
  } finally { process.env.AGENT_WORKFORCE_DATA = was; }
});

test('#7554 review 2: a variable set to empty is keyed apart from the same variable unset', { skip }, () => {
  const was = process.env.AGENT_WORKFORCE_DATA;
  const had = 'APPDATA' in process.env, prior = process.env.APPDATA;
  try {
    const g = looseRoot('empty');
    delete process.env.APPDATA;
    write(g.dir, 'empty1');
    const before = store._ensureRootCacheSizeForTest();
    process.env.APPDATA = '';
    write(g.dir, 'empty2');
    assert.equal(store._ensureRootCacheSizeForTest(), before + 1, 'APPDATA set to empty reused the entry for APPDATA unset');
  } finally {
    process.env.AGENT_WORKFORCE_DATA = was;
    if (had) process.env.APPDATA = prior; else delete process.env.APPDATA;
  }
});
