'use strict';
/*
 * #6563: `kosmos update` appended the installer's console to install.log while the installer already writes every
 * line there itself, so each line was logged twice. The installer now honours KOSMOS_LOG_FILE_ONLY=1 (file copy
 * only), and cmd_update sets it on the run-setup call. The REAL start_log is lifted out of setup.sh and run under
 * /bin/sh (the shell a person's `curl | sh` uses), against a scratch log folder.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const KOSMOS = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
function fnSource(src, name) {
  const at = src.indexOf('\n' + name + '() {\n');
  assert.notEqual(at, -1, name + ' is gone from install/setup.sh');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at + 1, end + 3);
}

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-logonce-6563-')); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

// Runs start_log, then prints two lines the way the installer narrates; returns the console and the log file.
function runStartLog(env) {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'home-'));
  const logDir = path.join(home, 'logs');
  const script = [
    'die() { echo "die: $*" >&2; exit 1; }',
    'KOSMOS_HOME="$1"; LOG_DIR="$1/logs"; LOG="$LOG_DIR/install.log"',
    fnSource(SETUP, 'start_log'),
    'start_log',
    'echo "first line"',
    'echo "second line"',
  ].join('\n');
  const r = spawnSync('/bin/sh', ['-c', script, 'sh', home], { env: { PATH: '/usr/bin:/bin', ...env }, encoding: 'utf8' });
  // The log is drained by a background awk; it flushes per line, but give it a moment to finish after the shell exits.
  const logFile = path.join(logDir, 'install.log');
  const deadline = Date.now() + 3000;
  let log = '';
  while (Date.now() < deadline) {
    log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    if (/second line/.test(log)) break;
    spawnSync('/bin/sleep', ['0.05']);
  }
  return { status: r.status, console: r.stdout, log };
}

const count = (s, re) => (s.match(re) || []).length;

test('#6563: KOSMOS_LOG_FILE_ONLY=1 logs each line to the file once and prints nothing to the console', () => {
  const r = runStartLog({ KOSMOS_LOG_FILE_ONLY: '1' });
  assert.equal(r.status, 0);
  assert.equal(count(r.log, /first line/g), 1, 'the file holds the line once: ' + r.log);
  assert.match(r.log, /^\[\d+\] first line$/m, 'the file copy keeps its run id');
  assert.equal(r.console, '', 'nothing on the console, which `kosmos update` appends to the same file');
});

test('#6563 control: unset, a person piping the installer still sees every line, and the file still gets it', () => {
  const r = runStartLog({});
  assert.equal(r.status, 0);
  assert.match(r.console, /^first line\nsecond line\n$/, 'the console shows each line, untagged');
  assert.equal(count(r.log, /first line/g), 1);
});

test('#6563: cmd_update tells the installer to log to the file only, on the run-setup call that appends to install.log', () => {
  const at = KOSMOS.indexOf('\ncmd_update() {');
  assert.notEqual(at, -1, 'cmd_update is gone from install/kosmos');
  const body = KOSMOS.slice(at, KOSMOS.indexOf('\n}\n', at));
  const call = body.split('\n').findIndex((l) => /run-setup "\$setup"/.test(l));
  assert.notEqual(call, -1, 'the run-setup call is gone from cmd_update');
  const lines = body.split('\n');
  assert.match(lines[call - 1] + lines[call], /KOSMOS_LOG_FILE_ONLY=1/, 'the run-setup call sets KOSMOS_LOG_FILE_ONLY=1');
  assert.match(lines[call], />>"\$LOG_DIR\/install\.log" 2>&1/, 'run-setup\'s own reasons still reach install.log');
});
