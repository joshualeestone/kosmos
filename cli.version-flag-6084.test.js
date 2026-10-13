'use strict';
/* #6084: `kosmos --version` printed "Unknown" and the command list, on every model family's agent, while
   `kosmos version` worked. Agents and people reach for --version first. --version and -v now print exactly what
   `kosmos version` prints. Driven against a throwaway Kosmos home, never the real install (as cli.version-4892). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, 'install', 'kosmos');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-version-flag-6084-'));
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

function run(...args) {
  const r = spawnSync('bash', [INSTALLED, ...args], { env: { ...process.env, KOSMOS_HOME: HOME_, HOME: SB }, encoding: 'utf8' });
  if (typeof r.status !== 'number') throw new Error('kosmos ' + args.join(' ') + ' gave no exit code: ' + (r.error ? r.error.message : r.signal));
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('#6084: kosmos --version and -v print exactly what kosmos version prints', () => {
  const want = run('version');
  assert.equal(want.code, 0, want.err);
  assert.equal(want.out, '9.9.9\n', 'premise: kosmos version prints the installed version');
  for (const flag of ['--version', '-v']) {
    const r = run(flag);
    assert.equal(r.code, 0, flag + ' failed: ' + r.err);
    assert.equal(r.out, want.out, flag + ' did not print the version');
    assert.equal(r.err, want.err, flag + ' said something kosmos version does not');
  }
});

test('#6084 CONTROL: a near miss is still unknown, so the alias did not open a catch-all', () => {
  const r = run('--versio');
  assert.equal(r.code, 2, 'a misspelled flag no longer refuses');
  assert.match(r.out + r.err, /Unknown: kosmos --versio/);
});
