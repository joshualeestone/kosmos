'use strict';
/* kosmos#8299: `kosmos --version` names the build as well, from the VERSION file the bundle carries. Driven against a
   throwaway Kosmos home, never the real install (as cli.version-flag-6084). */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, 'install', 'kosmos');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-version-8299-'));
const HOME_ = path.join(SB, 'kh');
fs.mkdirSync(path.join(HOME_, 'runtime', 'bin'), { recursive: true });
fs.mkdirSync(path.join(HOME_, 'app'), { recursive: true });
fs.mkdirSync(path.join(HOME_, 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME_, 'runtime', 'bin', 'node'));
fs.writeFileSync(path.join(HOME_, 'app', 'package.json'), JSON.stringify({ version: '9.9.9' }));
const INSTALLED = path.join(HOME_, 'bin', 'kosmos');
fs.copyFileSync(SRC, INSTALLED);
fs.chmodSync(INSTALLED, 0o755);
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

const VERSION = path.join(HOME_, 'VERSION');
function versionOut(contents, flag = '--version') {
  if (contents === null) fs.rmSync(VERSION, { force: true });
  else fs.writeFileSync(VERSION, contents);
  const r = spawnSync('bash', [INSTALLED, flag], { env: { ...process.env, KOSMOS_HOME: HOME_, HOME: SB }, encoding: 'utf8' });
  if (typeof r.status !== 'number') throw new Error('kosmos gave no exit code: ' + (r.error ? r.error.message : r.signal));
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const body = (app) => `app:    ${app}\nnode:   v24.19.0\nbuilt:  2026-11-09T03:27:06Z on macOS 27\n`;

test('kosmos#8299: the version line names the build, on every spelling of the verb', () => {
  const file = body('e224150682 (package.json 9.9.9)');
  for (const flag of ['--version', '-v', 'version']) assert.equal(versionOut(file, flag), '9.9.9 (build e224150682)\n', flag);
});

test('kosmos#8299: both ways a build says it was dirty are carried', () => {
  assert.equal(versionOut(body('e224150682-dirty (package.json 9.9.9)')), '9.9.9 (build e224150682-dirty)\n', 'the Mac bundle: git describe --dirty');
  assert.equal(versionOut(body('e224150682aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (dirty) (package.json 9.9.9)')), '9.9.9 (build e224150682-dirty)\n', 'the Linux bundle');
});

test('kosmos#8299: the full commit the Linux bundle records reads the same as the Mac bundle', () => {
  assert.equal(versionOut(body('e224150682aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (package.json 9.9.9)')), '9.9.9 (build e224150682)\n');
});

test('kosmos#8299: a VERSION file that is not valid text still leaves the version printed', () => {
  fs.writeFileSync(VERSION, Buffer.concat([Buffer.from('app:    e224150682 (package.json 9.9.9)\nnode:   '), Buffer.from([0xff, 0xfe]), Buffer.from('\n')]));
  const r = spawnSync('bash', [INSTALLED, '--version'], { env: { ...process.env, KOSMOS_HOME: HOME_, HOME: SB, LC_ALL: 'en_US.UTF-8' }, encoding: 'utf8' });
  if (typeof r.status !== 'number') throw new Error('kosmos gave no exit code: ' + (r.error ? r.error.message : r.signal));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '9.9.9 (build e224150682)\n');
});

test('kosmos#8299: with no build to name, the version alone', () => {
  assert.equal(versionOut(null), '9.9.9\n', 'no VERSION file');
  assert.equal(versionOut(body('unknown (package.json 9.9.9)')), '9.9.9\n', 'a build that could not say');
  assert.equal(versionOut('node:   v24.19.0\n'), '9.9.9\n', 'no app line');
});

test('kosmos#8299: only the app line is read, so the node line cannot pass for the build', () => {
  assert.equal(versionOut('node:   v24.19.0\napp:    abc1234567 (package.json 9.9.9)\n'), '9.9.9 (build abc1234567)\n');
});
