'use strict';

/* kosmos#8361, the Codex half: removing Kosmos on Windows takes its Codex file-edit hook (#8348) out of each named Codex
   home, by the #5999 rules: only our exact hooks.json, only this install's or one whose node or bridge is provably gone;
   the trust record only when it is exactly what install() wrote. The platform is injected, so this runs on any host. */

require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hooks = require('./codexhooks');
const V = hooks.HASH_VERIFIED_FOR;
const home = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uninstallhooks-8361-')));
const THIS = 'C:\\Users\\a\\AppData\\Local\\Programs\\Kosmos';
const OTHER = 'D:\\OtherKosmos';
const W = (root) => ({ platform: 'win32', node: root + '\\runtime\\node.exe' });
const bridgeIn = (root) => root + '\\app\\bin\\codex-report-bridge.js';
const cfgOf = (h) => fs.readFileSync(path.join(h, 'config.toml'), 'utf8');
const installed = (root, before) => {
  const h = home();
  if (before) fs.writeFileSync(path.join(h, 'config.toml'), before);
  assert.deepEqual(hooks.install(h, bridgeIn(root), V, W(root)), { ok: true });
  return h;
};

test('this install\'s hook and its exact trust record are taken out; the rest of config.toml stays', () => {
  const h = installed(THIS, 'model = "x"\n\n[projects.\'C:\\w\']\ntrust_level = "trusted"\n');
  const r = hooks.unwireInstall(h, [THIS], { platform: 'win32' });
  assert.deepEqual(r, { ours: true, changed: true, recordRemoved: true });
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
  assert.equal(cfgOf(h), 'model = "x"\n\n[projects.\'C:\\w\']\ntrust_level = "trusted"\n', 'only our two lines went');
});

test('a record in the middle goes with its blank line; the tables after it stay', () => {
  const h = installed(THIS, 'model = "x"\n');
  const later = '\n[projects.\'C:\\w\']\ntrust_level = "trusted"\n';
  fs.appendFileSync(path.join(h, 'config.toml'), later);
  assert.equal(hooks.unwireInstall(h, [THIS], { platform: 'win32' }).recordRemoved, true);
  assert.equal(cfgOf(h), 'model = "x"\n[projects.\'C:\\w\']\ntrust_level = "trusted"\n');
});

test('a record with a key below it (after a blank line) is not ours to remove: hooks.json goes, the record stays', () => {
  const h = installed(THIS);
  fs.appendFileSync(path.join(h, 'config.toml'), '\nenabled = false\n');
  const before = cfgOf(h);
  const r = hooks.unwireInstall(h, [THIS], { platform: 'win32' });
  assert.deepEqual(r, { ours: true, changed: true, recordRemoved: false });
  assert.equal(cfgOf(h), before);
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
});

test('the folder named in another spelling (forward slashes, other case) still counts as this install', () => {
  const h = installed(THIS);
  const r = hooks.unwireInstall(h, [THIS.replace(/\\/g, '/').toLowerCase()], { platform: 'win32' });
  assert.equal(r.changed, true);
});

test('another install\'s live hook stays, record and all', () => {
  const h = installed(OTHER);
  const before = { hooks: fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), cfg: cfgOf(h) };
  const r = hooks.unwireInstall(h, [THIS], { platform: 'win32', gone: () => false });
  assert.equal(r.changed, false);
  assert.equal(r.ours, false);
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), before.hooks);
  assert.equal(cfgOf(h), before.cfg);
});

test('another install\'s hook whose bridge is provably gone is taken out', () => {
  const h = installed(OTHER);
  const r = hooks.unwireInstall(h, [THIS], { platform: 'win32', gone: (p) => p === bridgeIn(OTHER) });
  assert.equal(r.changed, true);
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
});

test('a gone node.exe counts as gone; an install on a drive that is not there now (unplugged) is kept', () => {
  const h = installed(OTHER);
  const node = W(OTHER).node;
  assert.equal(hooks.unwireInstall(h, [THIS], { platform: 'win32', gone: (p) => p === node }).changed, true, 'a gone node.exe');
  const h2 = installed(OTHER);
  const r = hooks.unwireInstall(h2, [THIS], { platform: 'win32', gone: () => true });   // the drive root reads gone too
  assert.equal(r.changed, false, 'an unplugged drive is not a deleted folder');
  assert.equal(fs.existsSync(path.join(h2, 'hooks.json')), true);
});

test('a trust record changed by hand stays; only hooks.json goes', () => {
  const h = installed(THIS);
  const changed = cfgOf(h).replace(/sha256:[0-9a-f]{64}/, 'sha256:' + 'e'.repeat(64));
  fs.writeFileSync(path.join(h, 'config.toml'), changed);
  const r = hooks.unwireInstall(h, [THIS], { platform: 'win32' });
  assert.deepEqual(r, { ours: true, changed: true, recordRemoved: false });
  assert.equal(cfgOf(h), changed, 'the record someone changed is left as it is');
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
});

test('a person\'s own hooks.json, or none at all, is not touched', () => {
  const h = home();
  const theirs = '{"hooks":{"PreToolUse":[{"matcher":"apply_patch","hooks":[{"type":"command","command":"mine.ps1"}]}]}}\n';
  fs.writeFileSync(path.join(h, 'hooks.json'), theirs);
  assert.deepEqual(hooks.unwireInstall(h, [THIS], { platform: 'win32', gone: () => true }), { ours: false, changed: false });
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), theirs);
  assert.deepEqual(hooks.unwireInstall(home(), [THIS], { platform: 'win32' }), { ours: false, changed: false });
});

test('a hooks.json that cannot be read is not claimed as ours (it may be the person\'s own) and is left', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'hooks.json'));   // a read of it fails (EISDIR) on every platform
  const r = hooks.unwireInstall(h, [THIS], { platform: 'win32' });
  assert.equal(r.ours, false);
  assert.equal(r.changed, false);
  assert.equal(r.unreadable, true);
  assert.match(r.because, /could not be read/);
  assert.equal(fs.statSync(path.join(h, 'hooks.json')).isDirectory(), true);
});

test('a config.toml held by another writer leaves hooks.json and the record as they were, and says so', () => {
  const h = installed(THIS);
  const before = { hooks: fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), cfg: cfgOf(h) };
  fs.mkdirSync(path.join(h, 'config.toml.lock'));   // a live writer's lock: fresh, so never stolen as stale
  process.env.AGENT_WORKFORCE_LOCK_MS = '60';
  try {
    const r = hooks.unwireInstall(h, [THIS], { platform: 'win32' });
    assert.equal(r.ours, true);
    assert.equal(r.changed, false);
    assert.match(r.because, /another program was writing the Codex config/);
  } finally {
    delete process.env.AGENT_WORKFORCE_LOCK_MS;
    fs.rmSync(path.join(h, 'config.toml.lock'), { recursive: true, force: true });
  }
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), before.hooks);
  assert.equal(cfgOf(h), before.cfg);
});

test('a hooks.json changed to another command between the look and the lock is left', () => {
  const h = installed(THIS);
  const file = path.join(h, 'hooks.json');
  const real = require('./filelock');
  const orig = real.withFileLock;
  const swapped = fs.readFileSync(file, 'utf8').replace('codex-report-bridge.js', 'codex-report-bridge.js'.replace('bridge', 'bridge2'));
  // Swap the file just before the locked section runs, as a person's editor (which takes no lock of ours) could.
  real.withFileLock = (f, fn, o) => orig(f, () => { fs.writeFileSync(file, swapped); return fn(); }, o);
  try {
    const r = hooks.unwireInstall(h, [THIS], { platform: 'win32' });
    assert.equal(r.changed, false);
    assert.equal(r.unreadable, true, 'named for the person, as an unreadable one is');
  } finally { real.withFileLock = orig; }
  assert.equal(fs.readFileSync(file, 'utf8'), swapped);
});

// The uninstall wiring itself (only ~/.codex-<label>, never ~/.codex; the task gate; the sentences) is tested
// behaviourally in engine/win32uninstall.unhooks-5999.test.js.
