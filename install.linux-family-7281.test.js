'use strict';
/*
 * kosmos#7281 slice B: install/setup.sh installs the Linux x86_64 bundle (its own release family) on Linux x86_64,
 * once that family is published, and keeps the portable bundle until then (TRANSITIONAL, so this installer can ship
 * before the first Linux release). These run setup.sh's OWN text (cut from the file) under sh, with a stand-in
 * `uname` and a file:// release folder, so they test the shipped lines.
 *
 *   node --test install.linux-family-7281.test.js
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxfamily-7281-'));

/* setup.sh's text from `from` up to and including the first line that is exactly `to` after it. */
function cut(from, to) {
  const i = SETUP.indexOf(from);
  assert.ok(i > -1, 'setup.sh no longer has: ' + from);
  const j = SETUP.indexOf('\n' + to + '\n', i);
  assert.ok(j > i, 'setup.sh no longer closes the block at: ' + to);
  return SETUP.slice(i, j + to.length + 1);
}
const FAMILY = cut('LINUX_FAMILY=""', 'fi');
const ARCH_BLOCK = cut('    if [ -n "${KOSMOS_BUNDLE_ARCH:-}" ]; then', '    fi');

/* A bin folder whose `uname` answers as the given system and machine. */
function unameAs(sys, machine) {
  const d = fs.mkdtempSync(path.join(WORK, 'bin-'));
  fs.writeFileSync(path.join(d, 'uname'), `#!/bin/sh\ncase "$1" in -s) echo ${sys} ;; -m) echo ${machine} ;; *) echo ${sys} ;; esac\n`, { mode: 0o755 });
  return d;
}
function releaseDir(files) {
  const d = fs.mkdtempSync(path.join(WORK, 'dist-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
  return d;
}
function family({ sys = 'Linux', machine = 'x86_64', files = {}, channel = '' } = {}) {
  const dist = releaseDir(files);
  const r = spawnSync('sh', ['-c', `_PTR_FILE=latest.json\n${FAMILY}\nprintf '%s|%s' "$LINUX_FAMILY" "$_PTR_FILE"`], {
    encoding: 'utf8',
    env: { PATH: unameAs(sys, machine) + ':' + process.env.PATH, KOSMOS_RELEASE_BASE: 'file://' + dist, KOSMOS_UPDATE_CHANNEL: channel },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const PTR = JSON.stringify({ version: '0.7.71', sha256: 'a'.repeat(64), artifact: 'kosmos-0.7.71-linux-x64.tar.gz' });

test('#7281: a Linux x86_64 machine takes the Linux family when its pointer answers with a version', () => {
  assert.equal(family({ files: { 'latest-linux.json': PTR } }), 'yes|latest-linux.json');
  assert.equal(family({ files: { 'latest-linux-staging.json': PTR }, channel: 'staging' }), 'yes|latest-linux-staging.json', 'the staging channel reads the staging pointer');
  assert.equal(family({ files: { 'latest-linux.json': PTR }, channel: 'staging' }), '|latest.json', 'a staging install took the PROD Linux pointer');
});

test('#7281 TRANSITIONAL: with no Linux pointer published, or one with no version, it keeps the portable bundle', () => {
  assert.equal(family({}), '|latest.json');
  assert.equal(family({ files: { 'latest-linux.json': '<html>not found</html>' } }), '|latest.json', 'a 200 page that is not a pointer was taken for one');
});

test('#7281 CONTROL: a Mac, and a Linux computer that is not x86_64, never read the Linux pointer', () => {
  assert.equal(family({ sys: 'Darwin', machine: 'arm64', files: { 'latest-linux.json': PTR } }), '|latest.json');
  assert.equal(family({ machine: 'aarch64', files: { 'latest-linux.json': PTR } }), '|latest.json', 'an ARM Linux machine took the x86_64 bundle');
});

function arch(env) {
  const r = spawnSync('sh', ['-c', `info() { :; }\n${ARCH_BLOCK}\nprintf '%s' "$ARCH"`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('#7281: the Linux family downloads kosmos-<V>-linux-x64.*; otherwise the portable arm64 bundle, as before', () => {
  assert.equal(arch({ LINUX_FAMILY: 'yes' }), 'linux-x64');
  assert.equal(arch({ LINUX_FAMILY: '' }), 'arm64', 'CONTROL: unpublished family keeps the old download');
  assert.equal(arch({ LINUX_FAMILY: 'yes', KOSMOS_BUNDLE_ARCH: 'test-arch' }), 'test-arch', 'the test override no longer wins');
  assert.match(SETUP, /kosmos-\$TARGET_VERSION-\$ARCH\.tar\.gz/, 'the download name no longer follows ARCH');
});

test('#7281: for the Linux family the signed manifest is checked, the connector is required, and no system node stands in', () => {
  const code = SETUP.replace(/^\s*#.*$/gm, '');
  assert.match(code, /\{ \[ "\$\(uname -s\)" = "Darwin" \] \|\| \[ "\$\{LINUX_FAMILY:-\}" = yes \]; \} && ! update_manifest_ok pre/);
  assert.match(code, /\{ \[ "\$\(uname -s\)" = "Darwin" \] \|\| \[ "\$\{LINUX_FAMILY:-\}" = yes \]; \} && ! update_manifest_ok post/);
  assert.match(code, /if \[ "\$\(uname -s\)" != "Linux" \] \|\| \[ "\$\{LINUX_FAMILY:-\}" = yes \]; then\n\s+\[ -f "\$stage\/app\/bin\/kosmos-tunnel" \]/,
    'a Linux-family bundle without its connector would install');
  assert.match(code, /if \[ "\$\(uname -s\)" = "Linux" \] && \[ "\$\{LINUX_FAMILY:-\}" != yes \]; then\n\s+if \[ ! -f "\$stage\/runtime\/bin\/node" \]/,
    'a system node could stand in for the Linux family\'s own node');
});
