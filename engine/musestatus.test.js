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

/* ---- #3939 slice 3c-1: what Kosmos has seen about the credential, as events -------------------- */
/* Times are explicit (a fixed clock), never file mtimes: an mtime keeps fractions of a millisecond
   that Date.now() drops (review round 3). */

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
const clean = () => { fs.rmSync(muse.signedInMarker(), { force: true }); fs.rmSync(muse.eventsFolder(), { recursive: true, force: true }); };
const T = 1700000000000;
// An event written straight into the folder, as another board process would: the order of arrival is the test's.
const place = (kind, at, body) => {
  fs.mkdirSync(muse.eventsFolder(), { recursive: true });
  fs.writeFileSync(path.join(muse.eventsFolder(), String(at).padStart(15, '0') + '-' + kind + '-9.' + Math.random().toString(36).slice(2, 8) + '.json'), body === undefined ? '{}\n' : body);
};
const events = () => fs.readdirSync(muse.eventsFolder()).filter((n) => n.endsWith('.json') && !n.startsWith('.'));

test('#3939 3c-1: a refusal ends an earlier mark; a mark after it wins; a tie is signed out', () => withXdg(() => {
  clean();
  muse.markKosmosSignedIn(T);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'CONTROL: signed in before');
  assert.equal(muse.markSignedOut(T + 10), true);
  assert.deepEqual(muse.signedIn(), { signedIn: false, how: null }, 'the mark outlived a refused turn');
  muse.markKosmosSignedIn(T + 20);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'a mark after the refusal was not believed');
  clean();
  muse.markKosmosSignedIn(T + 10); place('note', T + 10);
  assert.equal(muse.signedIn().signedIn, false, 'a mark at the same moment as the refusal read as signed in');
  clean();
}));

test('#3939 3c-1: a sign-in that finished while a refused turn ran wins over that refusal (round 1)', () => withXdg(() => {
  clean();
  muse.markKosmosSignedIn(T + 50);
  muse.markSignedOut(T + 40, null, T + 60);          // began before the sign-in finished, reported after
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' });
  clean();
}));

test('#3939 3c-1: a success that began BEFORE a refusal does not undo it, either order of finishing (rounds 2 and 3)', () => withXdg(() => {
  clean();
  muse.markSignedOut(T + 50);
  muse.markTurnSignedIn(T + 40);
  assert.equal(muse.signedIn().signedIn, false, 'an older success undid a newer refusal');
  assert.equal(muse.markTurnSignedIn(T + 60), true, 'CONTROL: a success that began after the refusal counts');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' });
  clean();
  assert.equal(muse.markTurnSignedIn(T), true);           // turn A began at T and finished first
  assert.equal(muse.markSignedOut(T + 10), true, 'a refusal from a turn that began after A was dropped');
  assert.equal(muse.signedIn().signedIn, false, 'a slow success hid a later refusal');
  clean();
}));

test('#3939 3c-1 round 6: events from other boards, arriving in ANY order, never lose the newest fact', () => withXdg(() => {
  // Two refusals race: the older one lands last. The newer still decides.
  clean();
  place('note', T + 100); place('note', T + 90);
  muse.markKosmosSignedIn(T + 95);
  assert.equal(muse.latest().note.finish, T + 100, 'a late, older note displaced the newer one');
  assert.equal(muse.signedIn().signedIn, false, 'a sign-in between two refusals read as signed in');
  // A success never removes a note, even one that looked damaged (round 6 scenario B).
  clean();
  place('note', T + 50, 'garbled');
  place('note', T + 100);                                  // another board's genuine, later refusal
  muse.markTurnSignedIn(T + 60);
  assert.equal(events().filter((n) => /-note-/.test(n)).some((n) => n.startsWith(String(T + 100).padStart(15, '0'))), true, 'a success deleted a newer refusal');
  assert.equal(muse.signedIn().signedIn, false, 'a success hid another board\'s later refusal');
  clean();
}));

test('#3939 3c-1: older events of a kind are pruned; the newest of each stays; nothing temporary is left', () => withXdg(() => {
  clean();
  muse.markSignedOut(T); muse.markTurnSignedIn(T + 10); muse.markSignedOut(T + 20); muse.markTurnSignedIn(T + 30);
  const names = events();
  assert.equal(names.filter((n) => /-turn-/.test(n)).length, 1, 'older turns were not pruned: ' + names);
  assert.equal(names.filter((n) => /-note-/.test(n)).length, 1, 'older notes were not pruned: ' + names);
  assert.deepEqual(fs.readdirSync(muse.eventsFolder()).filter((n) => n.endsWith('.tmp')), [], 'a temporary file was left');
  assert.deepEqual(muse.latest(), { turn: T + 30, sign: null, note: { finish: T + 20, start: T + 20, digests: [], fileUnread: false, vanished: false } });
  clean();
}));

test('#3939 3c-1: slice 3a\'s single mark file (an ISO time, or none) is still read as a mark', () => withXdg(() => {
  clean();
  fs.mkdirSync(muse.signinFolder(), { recursive: true });
  fs.writeFileSync(muse.signedInMarker(), JSON.stringify({ at: new Date(T + 10).toISOString() }) + '\n');
  assert.equal(muse.markSignedOut(T + 20), true, 'CONTROL: a refusal after the old mark is written');
  assert.equal(muse.signedIn().signedIn, false, 'an old mark before the refusal read as signed in');
  fs.writeFileSync(muse.signedInMarker(), JSON.stringify({ at: new Date(T + 30).toISOString() }) + '\n');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'an old mark after the refusal was not believed');
  fs.writeFileSync(muse.signedInMarker(), '{}\n');   // no time at all: its mtime, which is now, after T+20
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'an old mark with no time was not read');
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
  writeAuth(xdg, {});
  assert.equal(muse.signedIn().signedIn, false, 'an emptied file read as signed in');
  for (const n of events()) assert.doesNotMatch(fs.readFileSync(path.join(muse.eventsFolder(), n), 'utf8'), /"t"|token/, 'an event kept the credential');
  clean();
}));

test('#3939 3c-1: the refused credential is the one the turn STARTED with (rounds 4 and 5)', () => withXdg((xdg) => {
  clean();
  writeAuth(xdg, { meta: { token: 'X' } });
  let atStart = muse.fileAtStart();
  writeAuth(xdg, { meta: { token: 'Y' } });           // `muse login` while the turn ran
  muse.markSignedOut(T, atStart);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'a credential written mid-turn was recorded as refused');
  clean();
  writeAuth(xdg, { meta: { token: 'X' } });
  atStart = muse.fileAtStart();
  writeAuth(xdg, {});                                  // `muse logout` while the turn ran
  muse.markSignedOut(T, atStart);
  writeAuth(xdg, { meta: { token: 'X' } });            // the refused credential comes back
  assert.equal(muse.signedIn().signedIn, false, 'the refused credential read as signed in after a mid-turn logout');
  // Round 4: a late, older refusal writes nothing, so it cannot replace the newer note's digest.
  clean();
  writeAuth(xdg, { meta: { token: 'X' } });
  muse.markSignedOut(T + 50);
  writeAuth(xdg, { meta: { token: 'Y' } });
  assert.equal(muse.markSignedOut(T + 10), false, 'a late, older refusal wrote');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'a late refusal marked a never-refused credential refused');
  clean();
}));

test('#3939 3c-1: a Muse file unread at the refusal, or a note body that cannot be read, never makes the file answer yes', () => withXdg((xdg) => {
  clean();
  const f = writeAuth(xdg, { meta: { token: 't' } });
  fs.chmodSync(f, 0o000);
  let atStart;
  try { atStart = muse.fileAtStart(); } finally { fs.chmodSync(f, 0o600); }
  assert.equal(atStart.fileUnread, true, 'CONTROL: the failed read was seen');
  muse.markSignedOut(T, atStart);
  assert.equal(muse.signedIn().signedIn, false, 'the refused credential came back once the file read again');
  clean();
  place('note', T, 'not json');
  assert.equal(muse.signedIn().signedIn, false, 'a garbled note let the file answer yes');
  assert.equal(muse.markTurnSignedIn(T + 10), true, 'CONTROL: a later completed turn still restores the answer');
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' });
  clean();
}));

test('#3939 3c-1: the writers never throw; they say false when they could not write', () => withXdg(() => {
  clean();
  fs.mkdirSync(muse.signinFolder(), { recursive: true });
  fs.writeFileSync(muse.eventsFolder(), 'not a folder');   // nothing can be written under a file
  try {
    let a; let b;
    assert.doesNotThrow(() => { a = muse.markSignedOut(T); b = muse.markTurnSignedIn(T); });
    assert.equal(a, false); assert.equal(b, false);
    assert.throws(() => muse.markKosmosSignedIn(T), 'CONTROL: Kosmos\'s own sign-in is told its mark was not written');
  } finally { fs.rmSync(muse.eventsFolder(), { force: true }); }
}));

test('#3939 3c-1 round 6: the latest event decides, whatever order the folder lists them in', () => withXdg(() => {
  // APFS lists names sorted, so "last listed" and "latest" agree on a Mac by accident; other
  // filesystems do not sort. Reverse the listing so only a real comparison passes.
  clean();
  place('note', T + 100); place('note', T + 90); place('turn', T + 95); place('turn', T + 80);
  const real = fs.readdirSync;
  fs.readdirSync = function (p, ...rest) {
    const r = real.call(this, p, ...rest);
    return String(p) === muse.eventsFolder() ? r.slice().sort().reverse() : r;
  };
  try {
    assert.deepEqual([muse.latest().turn, muse.latest().note.finish], [T + 95, T + 100], 'the listing order, not the time, decided');
    assert.equal(muse.signedIn().signedIn, false);
  } finally { fs.readdirSync = real; clean(); }
}));

test('#3939 3c-1 round 7: overlapping turns settle to signed out; a success counts only if it began after the refusal FINISHED', () => withXdg(() => {
  clean();
  // B began at T+120 and was refused at T+200; A began at T+130 (inside B) and completed.
  muse.markTurnSignedIn(T + 130);
  muse.markSignedOut(T + 120, null, T + 200);
  assert.equal(muse.signedIn().signedIn, false, 'an overlapping success hid a refusal');
  muse.markTurnSignedIn(T + 201);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'CONTROL: a success after the refusal finished counts');
  clean();
}));

test('#3939 3c-1 round 7: notes at the same moment are combined, failing closed', () => withXdg((xdg) => {
  clean();
  writeAuth(xdg, { meta: { token: 'Y' } });
  const dY = muse.fileAtStart().metaDigest;
  place('note', T, JSON.stringify({ start: T, metaDigest: 'x'.repeat(64), fileUnread: false }));
  place('note', T, JSON.stringify({ start: T, metaDigest: dY, fileUnread: false }));
  assert.equal(muse.signedIn().signedIn, false, 'a credential refused by either note answered yes');
  clean();
  place('note', T, JSON.stringify({ start: T, metaDigest: null, fileUnread: false }));
  place('note', T, JSON.stringify({ start: T, metaDigest: null, fileUnread: true }));
  assert.equal(muse.signedIn().signedIn, false, 'one unread note among two let the file answer yes');
  clean();
}));

test('#3939 3c-1 round 7: an event time that is not a whole number of milliseconds is refused, never written unseen', () => withXdg(() => {
  clean();
  muse.markKosmosSignedIn(T);
  for (const bad of [T + 10.5, NaN, -1, 1e15, Infinity]) {
    assert.equal(muse.markSignedOut(bad), false, 'a bad time was reported written: ' + bad);
  }
  assert.throws(() => muse.markKosmosSignedIn(1.5));
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'kosmos' }, 'CONTROL: nothing unseen was written');
  clean();
}));

test('#3939 3c-1 round 7: a slice 3a mark dated in the future is ignored; Kosmos\'s own sign-in removes that file', () => withXdg(() => {
  clean();
  fs.mkdirSync(muse.signinFolder(), { recursive: true });
  fs.writeFileSync(muse.signedInMarker(), JSON.stringify({ at: 1e14 }) + '\n');
  assert.equal(muse.signedIn().signedIn, false, 'a future-dated old mark answered yes');
  muse.markKosmosSignedIn(T);
  assert.equal(fs.existsSync(muse.signedInMarker()), false, 'the old single mark file outlived a sign-in');
  clean();
}));

test('#3939 3c-1 round 7: a failed save blocks an older sign-in but does not condemn the credential in Muse\'s file', () => withXdg((xdg) => {
  clean();
  muse.markKosmosSignedIn(T);
  muse.markSaveFailed(T + 10);
  assert.equal(muse.signedIn().signedIn, false, 'an older sign-in answered yes beside a failed save');
  clean();
  writeAuth(xdg, { meta: { token: 'good' } });   // in the file WHILE the save fails
  muse.markSaveFailed(T + 10);
  assert.deepEqual(muse.signedIn(), { signedIn: true, how: 'file' }, 'a failed save condemned a credential nothing refused');
  clean();
}));

/* #3939: the preview switch. The environment variable does not survive the installer rewriting the
   board's launchd job, so a marker file in the board's data folder turns Muse on for one computer. */
test('#3939: the preview marker turns Muse on (a Mac), and removing it turns it off, no restart', () => {
  const was = process.env.AGENT_WORKFORCE_MUSE;
  delete process.env.AGENT_WORKFORCE_MUSE;
  try {
    const marker = muse.previewMarker();
    assert.ok(marker.startsWith(SANDBOX), 'the marker must live in the sandboxed data folder: ' + marker);
    assert.equal(path.basename(marker), 'muse-preview-on');
    fs.rmSync(marker, { force: true });
    assert.equal(muse.enabled('darwin'), false, 'CONTROL: no marker, no variable: off');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '');
    assert.equal(muse.enabled('darwin'), true, 'the marker alone turns it on');
    assert.equal(muse.enabled('win32'), false, 'still a Mac only');
    fs.rmSync(marker);
    assert.equal(muse.enabled('darwin'), false, 'removing the marker turns it off again');
    process.env.AGENT_WORKFORCE_MUSE = '1';
    assert.equal(muse.enabled('darwin'), true, 'the variable still turns it on without the marker');
    process.env.AGENT_WORKFORCE_MUSE = '0';
    assert.equal(muse.enabled('darwin'), false, 'any other value of the variable is not on');
  } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_MUSE; else process.env.AGENT_WORKFORCE_MUSE = was;
  }
});
