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
  // Round 3: the end of the line is anchored too.
  assert.equal(muse.parseVersion('Muse Code 1.4.0 (1.4.0-R4161.1)\nWarning: update available'), null, 'a line after the version was ignored');
  assert.equal(muse.parseVersion('Muse Code 1.4.0 trailing'), null);
  assert.equal(muse.parseVersion('Muse Code 1.4.0.7'), null);
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
    late(null, 'Muse Code 1.4.0');   // a late answer after the cap does not throw
  } finally { muse.resetForTests(); }
});

test('#3939 round 3: a real muse that ignores TERM is stopped by SIGKILL at the timeout (not waited out)', { timeout: 8000, skip: process.platform !== 'darwin' && 'the Mac branch' }, async () => {
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  fs.writeFileSync(BIN, "#!/bin/sh\ntrap '' TERM\nexec sleep 30\n", { mode: 0o755 });
  // The hard cap is left long, so only the kill at the timeout can end this quickly.
  muse.setRunnerForTests(null, { timeoutMs: 300, hardCapMs: 20000 });
  gate.allowLiveExecution();
  try {
    const t0 = Date.now();
    const r = await muse.version();
    assert.ok(Date.now() - t0 < 5000, 'a child ignoring TERM kept version() waiting ' + (Date.now() - t0) + ' ms');
    assert.equal(r.version, null);
    assert.equal(r.because, muse.VERSION_UNKNOWN_BECAUSE);
  } finally { gate.resetForTests(); muse.resetForTests(); }
});

test('#3939 round 2: version() resolves (never rejects) even if finding muse throws', async () => {
  const real = runners.resolveBin;
  runners.resolveBin = () => { throw new Error('boom'); };
  try {
    const r = await muse.version();
    assert.equal(r.installed, null, 'a failed check read as a confident not-installed (round 3)');
    assert.equal(r.version, null);
    assert.equal(r.because, muse.CHECK_FAILED_BECAUSE);
  } finally { runners.resolveBin = real; }
});

/* ---- #3939 slice 3c-1: a refused turn clears the signed-in answer ------------------------------- */

const writeAuth = (dir, meta, mtimeSec) => {
  const f = path.join(dir, 'muse', 'auth.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ providers: meta ? { meta } : {} }));
  if (mtimeSec) fs.utimesSync(f, mtimeSec, mtimeSec);
  return f;
};
const clean = () => {
  fs.rmSync(muse.signedInMarker(), { force: true });
  fs.rmSync(muse.signedOutMarker(), { force: true });
};

test('#3939 3c-1: markSignedOut ends a Kosmos sign-in, and says it wrote the note', () => {
  clean();
  fs.mkdirSync(muse.signinFolder(), { recursive: true });
  fs.writeFileSync(muse.signedInMarker(), '{}\n');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'CONTROL: signed in through Kosmos before');
  assert.equal(muse.markSignedOut(), true);
  assert.equal(fs.existsSync(muse.signedInMarker()), false, 'the signed-in mark outlived a refused turn');
  assert.deepEqual(muse.signedIn(), { signedIn: false, how: null });
  clean();
});

test('#3939 3c-1: Muse\'s own file loses to a refusal after it, and wins when written after the refusal', () => {
  clean();
  const xdg = fs.mkdtempSync(path.join(SANDBOX, 'xdg-'));
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    const t0 = Math.floor(Date.now() / 1000) - 100;
    const f = writeAuth(xdg, { token: 'x' }, t0);
    assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'CONTROL: the file answers yes before any refusal');
    muse.markSignedOut();
    fs.utimesSync(muse.signedOutMarker(), t0 + 50, t0 + 50);
    assert.equal(muse.signedIn().signedIn, false, 'a file older than the refusal still answered yes');
    fs.utimesSync(f, t0 + 60, t0 + 60);   // Muse wrote its file again after the refusal (a sign-in in a terminal)
    assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'a sign-in after the refusal was not believed');
    writeAuth(xdg, null, t0 + 70);         // `muse logout` leaves {"providers":{}}
    assert.equal(muse.signedIn().signedIn, false, 'an emptied file read as signed in');
  } finally {
    if (was === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = was;
    clean();
  }
});

test('#3939 3c-1: markSignedOut never throws, and says false when it could not write', () => {
  clean();
  const folder = muse.signinFolder();
  fs.rmSync(folder, { recursive: true, force: true });
  fs.writeFileSync(folder, 'not a folder');   // the note cannot be written under a file
  try {
    let r;
    assert.doesNotThrow(() => { r = muse.markSignedOut(); });
    assert.equal(r, false);
  } finally { fs.rmSync(folder, { force: true }); }
});
