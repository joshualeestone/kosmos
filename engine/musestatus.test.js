'use strict';
/*
 * #3939 first slice: engine/musestatus.js and runners.resolveBin('muse'). A fake `muse` in a sandboxed
 * home stands in for Meta's launcher; the real one is never run here.
 *
 *   node --test engine/musestatus.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-status-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_MUSE_BIN;
const runners = require('./runners');
const muse = require('./musestatus');
const gate = require('./live-execution');
test.after(() => { gate.resetForTests(); muse.resetForTests(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const BIN = path.join(SANDBOX, '.local', 'bin', 'muse');
function fakeMuse(line) {
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  fs.writeFileSync(BIN, '#!/bin/sh\necho "' + line + '"\n', { mode: 0o755 });
}

test('#3939: the version line Muse Code prints is read; anything else is not a version', () => {
  assert.deepEqual(muse.parseVersion('Muse Code 1.4.0 (1.4.0-R4161.1)\n'), { version: '1.4.0', build: '1.4.0-R4161.1' });
  assert.deepEqual(muse.parseVersion('Muse Code 1.5.2'), { version: '1.5.2', build: null });
  assert.equal(muse.parseVersion('muse: command not found'), null);
  assert.equal(muse.parseVersion('Muse Spark 1.0.0'), null, 'another Meta product read as Muse Code');
  assert.equal(muse.parseVersion(''), null);
  assert.equal(muse.parseVersion('some banner\nMuse Code 9.9.9\nother junk'), null, 'a version line inside other output was taken (round 1)');
});

test('#3939: not installed until ~/.local/bin/muse is there and runnable (a Mac)', { skip: process.platform !== 'darwin' && 'the Mac branch' }, () => {
  fs.rmSync(path.join(SANDBOX, '.local'), { recursive: true, force: true });
  assert.equal(muse.installed().installed, false);
  fakeMuse('Muse Code 1.4.0 (1.4.0-R4161.1)');
  const r = muse.installed();
  assert.equal(r.installed, true, 'the launcher in the sandboxed home was not found');
  assert.equal(r.bin, BIN, 'it looked somewhere other than the (sandboxed) home');
  fs.chmodSync(BIN, 0o644);
  assert.equal(muse.installed().installed, false, 'a file that cannot run counted as installed');
  fs.chmodSync(BIN, 0o755);
});

test('#3939: not a Mac, not wired up yet (Windows is its own slice)', () => {
  const r = runners.resolveBin('muse', { platform: 'win32' });
  assert.equal(r.present, false);
  assert.match(r.because, /not wired up/);
});

test('#3939: an override names the file, present or not, and says which variable', () => {
  process.env.AGENT_WORKFORCE_MUSE_BIN = path.join(SANDBOX, 'nowhere', 'muse');
  try {
    const r = runners.resolveBin('muse');
    assert.equal(r.present, false);
    assert.equal(r.overridden, true);
    assert.equal(r.envName, 'AGENT_WORKFORCE_MUSE_BIN');
  } finally { delete process.env.AGENT_WORKFORCE_MUSE_BIN; }
});

test('#3939: muse is not in MANIFEST, so runners.status() (every screen) does not list it yet', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(runners.MANIFEST, 'muse'), false);
});

test('#3939: version() reads the launcher it found, through the live-execution gate', { skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  fakeMuse('Muse Code 1.4.0 (1.4.0-R4161.1)');
  gate.resetForTests();
  const refused = await muse.version();   // version() never rejects
  assert.equal(refused.version, null, 'with the gate closed, the binary ran: ' + JSON.stringify(refused));
  assert.equal(refused.because, muse.VERSION_UNKNOWN_BECAUSE);
  gate.allowLiveExecution();
  try {
    assert.deepEqual(await muse.version(), { installed: true, version: '1.4.0', build: '1.4.0-R4161.1', because: null });
    fakeMuse('something else entirely');
    const odd = await muse.version();
    assert.equal(odd.version, null, 'an answer that is not Muse Code\'s line was taken as a version');
    assert.match(odd.because, /could not read/);
  } finally { gate.resetForTests(); }
  fs.rmSync(path.join(SANDBOX, '.local'), { recursive: true, force: true });
  const none = await muse.version();
  assert.equal(none.installed, false);
  assert.match(none.because, /not on this computer/);
});

test('#3939 round 1: a muse that never answers still gives an answer (unknown), not a hang', { timeout: 5000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  fakeMuse('Muse Code 1.4.0 (1.4.0-R4161.1)');
  let late = null;
  muse.setRunnerForTests((bin, done) => { late = done; }, { hardCapMs: 200 });   // never calls back
  try {
    const t0 = Date.now();
    const r = await muse.version();
    assert.ok(Date.now() - t0 < 5000, 'version() waited on a child that never answered');
    assert.equal(r.version, null);
    assert.equal(r.because, muse.VERSION_UNKNOWN_BECAUSE);
    late(null, 'Muse Code 1.4.0');   // a late answer is ignored, and nothing throws
  } finally { muse.resetForTests(); }
});

test('#3939 round 1: the real child is stopped with SIGKILL (a launcher that ignores TERM cannot keep it waiting)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'musestatus.js'), 'utf8');
  assert.match(src, /killSignal: 'SIGKILL'/);
  assert.match(src, /maxBuffer: VERSION_MAX_BUFFER/);
});
