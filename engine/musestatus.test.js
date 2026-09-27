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

/* ---- #3939 slice 3c-1: what Kosmos has seen about the credential ------------------------------ */
/* Times are set INSIDE the records, never through file mtimes: an mtime keeps fractions of a
   millisecond that Date.now() drops, which made an earlier version of these tests fail at random
   (review round 3). */

const withXdg = (fn) => {
  const was = process.env.XDG_CONFIG_HOME;
  const xdg = fs.mkdtempSync(path.join(SANDBOX, 'xdg-'));
  process.env.XDG_CONFIG_HOME = xdg;   // never the real auth.json (round 1)
  try { return fn(xdg); } finally { if (was === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = was; }
};
const writeAuth = (xdg, text) => {
  const f = path.join(xdg, 'muse', 'auth.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify({ providers: text }));
  return f;
};
const clean = () => { fs.rmSync(muse.signedInMarker(), { force: true }); fs.rmSync(muse.signedOutMarker(), { force: true }); };
const markAt = (ms) => { fs.mkdirSync(muse.signinFolder(), { recursive: true }); fs.writeFileSync(muse.signedInMarker(), JSON.stringify({ at: ms }) + '\n'); };
const T = 1700000000000;   // a fixed clock: every ordering below is explicit

test('#3939 3c-1: a refusal ends an earlier mark; a mark after it wins; a tie is signed out', () => withXdg(() => {
  clean();
  markAt(T);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'CONTROL: signed in before');
  assert.equal(muse.markSignedOut(T + 10), true);
  assert.deepEqual(muse.signedIn(), { signedIn: false, how: null }, 'the mark outlived a refused turn');
  markAt(T + 20);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'a mark after the refusal was not believed');
  markAt(T + 10);
  assert.equal(muse.signedIn().signedIn, false, 'a mark at the same moment as the refusal read as signed in');
  clean();
}));

test('#3939 3c-1: a refusal from a turn that began BEFORE a sign-in finished does not undo it (round 1)', () => withXdg(() => {
  clean();
  markAt(T + 50);
  assert.equal(muse.markSignedOut(T + 40), false, 'the stale refusal wrote a note over the new sign-in');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' });
  clean();
}));

test('#3939 3c-1: a success that began BEFORE a refusal does not undo it, either order of finishing (rounds 2 and 3)', () => withXdg(() => {
  // Round 2: the refusal is written first, then the older success finishes.
  clean();
  muse.markSignedOut(T + 50);
  assert.equal(muse.markTurnSignedIn(T + 40), false, 'an older success wrote over a newer refusal');
  assert.equal(muse.signedIn().signedIn, false);
  assert.equal(muse.markTurnSignedIn(T + 60), true, 'CONTROL: a success that began after the refusal counts');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' });
  // Round 3: the older success finishes FIRST (no note yet), then the newer turn is refused.
  clean();
  assert.equal(muse.markTurnSignedIn(T), true);           // turn A began at T and finished at T+30
  assert.equal(muse.markSignedOut(T + 10), true, 'a refusal from a turn that began after A was dropped');
  assert.equal(muse.signedIn().signedIn, false, 'a slow success hid a later refusal');
  clean();
}));

test('#3939 3c-1: neither record ever moves back in time', () => withXdg(() => {
  clean();
  muse.markSignedOut(T + 50); muse.markSignedOut(T + 20);
  assert.equal(JSON.parse(fs.readFileSync(muse.signedOutMarker(), 'utf8')).at, T + 50, 'the note moved back');
  clean();
  markAt(T + 50); muse.markTurnSignedIn(T + 20);
  assert.equal(JSON.parse(fs.readFileSync(muse.signedInMarker(), 'utf8')).at, T + 50, 'the mark moved back');
  clean();
}));

test('#3939 3c-1: a mark from before this slice (an ISO time, or none) is still read', () => withXdg(() => {
  clean();
  fs.mkdirSync(muse.signinFolder(), { recursive: true });
  fs.writeFileSync(muse.signedInMarker(), JSON.stringify({ at: new Date(T + 10).toISOString() }) + '\n');
  assert.equal(muse.markSignedOut(T + 20), true, 'CONTROL: a refusal after an ISO mark is written');
  assert.equal(muse.signedIn().signedIn, false, 'an ISO mark before the refusal read as signed in');
  fs.writeFileSync(muse.signedInMarker(), JSON.stringify({ at: new Date(T + 30).toISOString() }) + '\n');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'an ISO mark after the refusal was not believed');
  fs.writeFileSync(muse.signedInMarker(), '{}\n');   // no time at all: the mtime, which is now, after T+20
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'a mark with no time was not read');
  clean();
}));

test('#3939 3c-1: Muse\'s own file counts again only for a DIFFERENT credential, in any key order', () => withXdg((xdg) => {
  clean();
  writeAuth(xdg, '{"providers":{"meta":{"token":"t","expiresAt":5,"extra":{"a":1,"b":2}}}}');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'CONTROL: the file answers yes before any refusal');
  muse.markSignedOut(T);
  assert.equal(muse.signedIn().signedIn, false, 'the refused credential still answered yes');
  writeAuth(xdg, '{"providers":{"openai":{"k":1},"meta":{"extra":{"b":2,"a":1},"expiresAt":5,"token":"t"}}}');
  assert.equal(muse.signedIn().signedIn, false, 'a rewrite (another provider, keys reordered) revived the refused credential');
  writeAuth(xdg, '{"providers":{"meta":{"token":"new"}}}');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'a new credential was not believed');
  writeAuth(xdg, {});                              // `muse logout` leaves {"providers":{}}
  assert.equal(muse.signedIn().signedIn, false, 'an emptied file read as signed in');
  assert.doesNotMatch(fs.readFileSync(muse.signedOutMarker(), 'utf8'), /"t"|token/, 'the note kept the credential, not a digest');
  clean();
}));

test('#3939 3c-1: a Muse file that could not be read at the refusal does not come back as signed in (round 3)', () => withXdg((xdg) => {
  clean();
  const f = writeAuth(xdg, { meta: { token: 't' } });
  fs.chmodSync(f, 0o000);
  try { muse.markSignedOut(T); } finally { fs.chmodSync(f, 0o600); }
  assert.equal(JSON.parse(fs.readFileSync(muse.signedOutMarker(), 'utf8')).fileUnread, true, 'CONTROL: the failed read was recorded');
  assert.equal(muse.signedIn().signedIn, false, 'the refused credential came back once the file read again');
  assert.equal(muse.markTurnSignedIn(T + 10), true, 'CONTROL: a later completed turn still restores the answer');
  assert.equal(muse.signedIn().signedIn, true);
  clean();
}));

test('#3939 3c-1: a note that cannot be read is a refusal, and a completed turn clears it (round 3)', () => withXdg((xdg) => {
  clean();
  writeAuth(xdg, { meta: { token: 'x' } });
  markAt(T);
  fs.writeFileSync(muse.signedOutMarker(), 'not json');
  assert.deepEqual(muse.signedIn(), { signedIn: false, how: null }, 'an unreadable note let the file or the mark answer yes');
  assert.equal(muse.markTurnSignedIn(T + 10), true, 'an unreadable note blocked every later turn');
  assert.equal(fs.existsSync(muse.signedOutMarker()), false);
  assert.equal(muse.signedIn().signedIn, true);
  clean();
}));

test('#3939 3c-1: markSignedOut and markTurnSignedIn never throw, and say false when they could not write', () => withXdg(() => {
  clean();
  const folder = muse.signinFolder();
  fs.rmSync(folder, { recursive: true, force: true });
  fs.writeFileSync(folder, 'not a folder');   // nothing can be written under a file
  try {
    let a; let b;
    assert.doesNotThrow(() => { a = muse.markSignedOut(T); b = muse.markTurnSignedIn(T); });
    assert.equal(a, false); assert.equal(b, false);
  } finally { fs.rmSync(folder, { force: true }); }
}));

test('#3939 3c-1 round 4: a late refusal never rewrites a newer note\'s digest, in either direction', () => withXdg((xdg) => {
  // A: a new credential arrives after the newer refusal; an older refusal reporting late must not mark it refused.
  clean();
  writeAuth(xdg, { meta: { token: 'X' } });
  assert.equal(muse.markSignedOut(T + 50), true);
  writeAuth(xdg, { meta: { token: 'Y' } });
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'CONTROL: a new credential answers yes');
  const before = fs.readFileSync(muse.signedOutMarker(), 'utf8');
  assert.equal(muse.markSignedOut(T + 10), false, 'a late, older refusal wrote');
  assert.equal(fs.readFileSync(muse.signedOutMarker(), 'utf8'), before, 'a late refusal rewrote the newer note');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'a late refusal marked a never-refused credential refused');
  // B: the file is briefly empty when the late refusal reports; the refused credential then reappears.
  clean();
  writeAuth(xdg, { meta: { token: 'X' } });
  muse.markSignedOut(T + 50);
  writeAuth(xdg, {});
  muse.markSignedOut(T + 10);
  writeAuth(xdg, { meta: { token: 'X' } });
  assert.equal(muse.signedIn().signedIn, false, 'the still-refused credential read as signed in after a late refusal');
  clean();
}));
