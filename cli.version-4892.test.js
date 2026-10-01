'use strict';
/* #4892: `kosmos version` printed the installed app's version even when the command being run was an old patched
   copy elsewhere (an agent's in /tmp, lacking newer commands). It now says so on stderr; stdout stays the version.
   Driven against a throwaway Kosmos home, never the real install. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, 'install', 'kosmos');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-version-4892-'));
const HOME_ = path.join(SB, 'kosmos-home');
fs.mkdirSync(path.join(HOME_, 'runtime', 'bin'), { recursive: true });
fs.mkdirSync(path.join(HOME_, 'app'), { recursive: true });
fs.mkdirSync(path.join(HOME_, 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME_, 'runtime', 'bin', 'node'));
fs.writeFileSync(path.join(HOME_, 'app', 'package.json'), JSON.stringify({ version: '9.9.9' }));
const INSTALLED = path.join(HOME_, 'bin', 'kosmos');
fs.copyFileSync(SRC, INSTALLED);
fs.chmodSync(INSTALLED, 0o755);
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

function run(script) {
  const r = spawnSync('bash', [script, 'version'], { env: { ...process.env, KOSMOS_HOME: HOME_, HOME: SB }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('#4892: the installed command prints the version and nothing else', () => {
  const r = run(INSTALLED);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '9.9.9\n');
  assert.equal(r.err, '');
});

test('#4892: an identical copy elsewhere behaves the same and is not flagged', () => {
  const copy = path.join(SB, 'same-kosmos');
  fs.copyFileSync(INSTALLED, copy);
  const r = run(copy);
  assert.equal(r.out, '9.9.9\n');
  assert.equal(r.err, '');
});

test('#4892: a patched copy elsewhere says it is not the installed one, on stderr, and stdout stays the version', () => {
  const patched = path.join(SB, 'tmp-kosmos');
  fs.writeFileSync(patched, fs.readFileSync(INSTALLED, 'utf8') + '\n# a local patch\n');
  const r = run(patched);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '9.9.9\n', 'stdout is no longer just the version');
  assert.match(r.err, /This kosmos command \(.*tmp-kosmos\) is not the one installed with Kosmos/);
  assert.ok(r.err.includes(INSTALLED), 'the warning does not name the command to run instead');
  assert.ok(!/—/.test(r.err));
});
