'use strict';

/**
 * #6468 ask 1: install/setup.sh's update_signer_ok refuses a downloaded update whose signed parts are not signed like
 * the installed ones, before anything in the new build runs.
 *
 * The real function is lifted out of setup.sh and run under /bin/sh. The "installed" parts are copies of Apple's own
 * /bin/ls and /bin/cat, whose designated requirements (identifier + anchor apple) stand in for a Developer ID one:
 * no keychain or certificate is needed, and a copy keeps its signature. The forged parts are ad-hoc re-signed copies,
 * which is what a tarball built without the release key looks like.
 *
 *   node --test install.update-signer-6468.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const MAC = process.platform === 'darwin' || 'macOS codesign';
const it = (name, fn) => test(name, { skip: MAC === true ? false : MAC }, fn);
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
function fnSource(name) {
  const at = SETUP.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = SETUP.indexOf('\n}\n', at);
  return SETUP.slice(at + 1, end + 3);
}

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-signer-6468-')); });
test.after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

/** A tree with runtime/bin/node and app/bin/kosmos-tunnel copied from `node` and `tunnel` (paths), ad-hoc re-signed when asked. */
function tree(node, tunnel, { adhoc = [] } = {}) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 't-'));
  const parts = { 'runtime/bin/node': node, 'app/bin/kosmos-tunnel': tunnel };
  for (const [rel, src] of Object.entries(parts)) {
    if (!src) continue;
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
    if (adhoc.includes(rel)) execFileSync('/usr/bin/codesign', ['--force', '-s', '-', dst], { stdio: 'ignore' });
  }
  return root;
}

function check(stage, dest) {
  const script = ['set -u', 'info() { printf "%s\\n" "$*"; }', fnSource('update_signer_ok'),
    'update_signer_ok "$1" "$2"'].join('\n');
  const r = spawnSync('/bin/sh', ['-c', script, 'sh', stage, dest], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

it('control: an update signed like the installed build is accepted', () => {
  const dest = tree('/bin/ls', '/bin/cat');
  const r = check(tree('/bin/ls', '/bin/cat'), dest);
  assert.equal(r.code, 0, r.out);
});

it('a re-signed runtime is refused, and named', () => {
  const dest = tree('/bin/ls', '/bin/cat');
  const r = check(tree('/bin/ls', '/bin/cat', { adhoc: ['runtime/bin/node'] }), dest);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /runtime\/bin\/node is not signed by the same developer/);
});

it('a part signed by someone else (a different identifier) is refused', () => {
  const dest = tree('/bin/ls', '/bin/cat');
  const r = check(tree('/bin/ls', '/bin/ls'), dest);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /kosmos-tunnel is not signed by the same developer/);
});

it('an unsigned part is refused', () => {
  const dest = tree('/bin/ls', '/bin/cat');
  const stage = tree('/bin/ls', '/bin/cat');
  fs.writeFileSync(path.join(stage, 'app/bin/kosmos-tunnel'), '#!/bin/sh\n', { mode: 0o755 });
  const r = check(stage, dest);
  assert.equal(r.code, 1, r.out);
});

it('a symlink in place of a part is refused', () => {
  const dest = tree('/bin/ls', '/bin/cat');
  const stage = tree('/bin/ls', null);
  fs.mkdirSync(path.join(stage, 'app/bin'), { recursive: true });
  fs.symlinkSync('/bin/cat', path.join(stage, 'app/bin/kosmos-tunnel'));
  const r = check(stage, dest);
  assert.equal(r.code, 1, r.out);
});

it('an ad-hoc (local build) install is not held to a signer, and says so', () => {
  const dest = tree('/bin/ls', '/bin/cat', { adhoc: ['runtime/bin/node', 'app/bin/kosmos-tunnel'] });
  const r = check(tree('/bin/cat', '/bin/ls', { adhoc: ['runtime/bin/node'] }), dest);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /installed runtime\/bin\/node is not a signed release/);
});

it('the installer calls it before the new runtime is first run, on the downloaded path only', () => {
  const call = SETUP.indexOf('! update_signer_ok "$stage" "$dest"');
  assert.notEqual(call, -1, 'install_kosmos no longer calls update_signer_ok');
  const fn = SETUP.indexOf('\ninstall_kosmos() {\n');
  const probe = SETUP.indexOf('if ! "$stage/runtime/bin/node" --version', fn);
  assert.ok(fn < call && call < probe, 'the check must sit inside install_kosmos, before the runtime probe');
  assert.match(SETUP.slice(call - 120, call), /"\$from_network" = yes/);
});
