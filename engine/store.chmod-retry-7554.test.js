'use strict';

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits

/**
 * #7554 (follow-ups to #1760): a transient chmod failure on the data root (EBUSY) is tried again on the next write, while
 * a lasting one (EPERM, EACCES) is not retried by ensure() on every write but still is by the board's start call.
 * POSIX modes only, so these skip on Windows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'chmodretry-7554-')));
process.env.AGENT_WORKFORCE_DATA = SB;
delete process.env.AGENT_WORKFORCE_HOME;
test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* temp */ } });

const store = require('./store');
const skip = process.platform === 'win32';
const modeOf = (p) => fs.statSync(p).mode & 0o777;

/* A fresh data folder whose root exists at 0755, so no earlier write in this process has tried it. */
function looseRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chmodretry-7554-' + tag + '-'));
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
