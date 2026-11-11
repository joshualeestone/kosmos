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

test('the uninstall names only the ~/.codex-<label> homes, never ~/.codex', () => {
  const src = fs.readFileSync(path.join(__dirname, 'win32uninstall.js'), 'utf8');
  assert.match(src, /d\.startsWith\('\.codex-'\)/);
  assert.match(src, /require\('\.\/codexhooks'\)\.unwireInstall\(codexHome, roots/);
});
