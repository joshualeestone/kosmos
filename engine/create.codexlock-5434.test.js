'use strict';
/**
 * kosmos#5434 slice 8: the two Kosmos writers of the person's `~/.codex/config.toml`, trustCodexFolder and
 * forgetCodexFolder, take one lock on it, so a trust append landing inside a forget's read-edit-rename is
 * refused rather than silently lost; and trustCodexFolder's append is flushed to disk (#5431), with the folder
 * flushed after the append that created the file.
 *
 *   node --test engine/create.codexlock-5434.test.js
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every root create.js resolves at require time, in this file's own sandbox (as create.test.js does).
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'create-codexlock-')));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd-user');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const create = require('./create');

let N = 0;
function folder() { const d = path.join(SANDBOX, 'work-' + (++N)); fs.mkdirSync(d, { recursive: true }); return d; }
function freshHome() { const h = path.join(SANDBOX, 'codex-' + (++N)); fs.mkdirSync(h, { recursive: true }); return h; }
const cfgOf = (home) => path.join(home, 'config.toml');
/* Whether config.toml holds a trust entry for `dir`, in the spelling trustCodexFolder writes. */
const holds = (home, dir) => fs.readFileSync(cfgOf(home), 'utf8').includes(require('./trust').canonicalOnDisk(dir));

/* The lock wait is 0 inside `fn`, so a held lock answers at once instead of after the default wait. */
function noWait(fn) {
  const prev = process.env.AGENT_WORKFORCE_LOCK_MS;
  process.env.AGENT_WORKFORCE_LOCK_MS = '0';
  try { return fn(); } finally { if (prev === undefined) delete process.env.AGENT_WORKFORCE_LOCK_MS; else process.env.AGENT_WORKFORCE_LOCK_MS = prev; }
}

/* (fdPath maps an fd to its path while `fn` runs; a reused fd number is overwritten by its next open.) */
function recording(fn) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realWrite = fs.writeSync;
  const realFsync = fs.fsyncSync;
  fs.openSync = (target, ...rest) => { const fd = realOpen.call(fs, target, ...rest); fdPath.set(fd, String(target)); return fd; };
  fs.writeSync = (fd, ...rest) => { events.push(['write', fdPath.get(fd)]); return realWrite.call(fs, fd, ...rest); };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; fs.writeSync = realWrite; fs.fsyncSync = realFsync; }
  return { events, out };
}

test('#5434: the trust append is flushed after it is written', () => {
  const home = freshHome();
  fs.writeFileSync(cfgOf(home), 'model = "gpt-5"\n', { mode: 0o600 });
  const dir = folder();
  const { events } = recording(() => create.trustCodexFolder(dir, home));
  assert.ok(holds(home, dir), 'the trust entry was not written');
  const w = events.findIndex((e) => e[0] === 'write' && e[1] === cfgOf(home));
  assert.ok(w >= 0, 'no write to config.toml: ' + JSON.stringify(events));
  assert.ok(events.slice(w + 1).some((e) => e[0] === 'fsync' && e[1] === cfgOf(home)),
    'config.toml was never flushed after the append: ' + JSON.stringify(events));
  assert.equal(fs.readFileSync(cfgOf(home), 'utf8').startsWith('model = "gpt-5"\n'), true, 'the person\'s own line was not kept first');
});

test('#5434: the append that creates config.toml flushes its folder too', { skip: process.platform === 'win32' && 'no folder flush on Windows' }, () => {
  const home = path.join(SANDBOX, 'not-yet-' + (++N)); // trustCodexFolder makes it
  const dir = folder();
  const { events } = recording(() => create.trustCodexFolder(dir, home));
  assert.ok(holds(home, dir), 'the trust entry was not written');
  assert.ok(events.some((e) => e[0] === 'fsync' && e[1] === home), 'the folder of a new config.toml was not flushed: ' + JSON.stringify(events));
});

test('#5434: a second trust of the same folder writes nothing', () => {
  const home = freshHome();
  const dir = folder();
  create.trustCodexFolder(dir, home);
  const before = fs.readFileSync(cfgOf(home), 'utf8');
  const { events } = recording(() => create.trustCodexFolder(dir, home));
  assert.equal(fs.readFileSync(cfgOf(home), 'utf8'), before);
  assert.equal(events.filter((e) => e[0] === 'write').length, 0, 'an existing entry was written again');
});

test('#5434: both writers release the lock', () => {
  const home = freshHome();
  const dir = folder();
  create.trustCodexFolder(dir, home);
  assert.equal(fs.existsSync(cfgOf(home) + '.lock'), false, 'trustCodexFolder left config.toml.lock behind');
  const out = create.forgetCodexFolder(dir, home);
  assert.equal(out.removed, true, JSON.stringify(out));
  assert.equal(fs.existsSync(cfgOf(home) + '.lock'), false, 'forgetCodexFolder left config.toml.lock behind');
});

test('#5434: a held lock refuses both writers, with a sentence, and leaves config.toml as it was', () => {
  const home = freshHome();
  const kept = folder();
  create.trustCodexFolder(kept, home);
  const before = fs.readFileSync(cfgOf(home), 'utf8');
  fs.mkdirSync(cfgOf(home) + '.lock'); // a live holder: fresh, so never stolen
  try {
    noWait(() => assert.throws(() => create.trustCodexFolder(folder(), home), /did not finish in time, so the folder trust was not written/));
    const out = noWait(() => create.forgetCodexFolder(kept, home));
    assert.deepEqual(out, { ok: false, removed: false, because: 'another Kosmos change to the codex config did not finish in time, so the folder trust was not taken back' });
    assert.equal(fs.readFileSync(cfgOf(home), 'utf8'), before, 'a writer changed config.toml without the lock');
  } finally { fs.rmdirSync(cfgOf(home) + '.lock'); }
});

test('#5434: a trust that lands inside a forget is refused, never silently lost', () => {
  const home = freshHome();
  const leaving = folder();
  const arriving = folder();
  create.trustCodexFolder(leaving, home);
  /* At the forget's read of config.toml, a trust for another folder runs: the interleave the lock exists for. */
  const realRead = fs.readFileSync;
  let landed = null;
  fs.readFileSync = function (p, ...rest) {
    const out = realRead.call(fs, p, ...rest);
    if (landed === null && String(p) === cfgOf(home)) {
      fs.readFileSync = realRead;
      try { noWait(() => create.trustCodexFolder(arriving, home)); landed = true; }
      catch (e) {
        // Refused BY THE LOCK, not by anything else that throws, or this arm would measure nothing (review 1).
        assert.match(String(e && e.message), /did not finish in time, so the folder trust was not written/);
        landed = false;
      }
    }
    return out;
  };
  let out;
  try { out = create.forgetCodexFolder(leaving, home); } finally { fs.readFileSync = realRead; }
  assert.notEqual(landed, null, 'the interleave never ran, so this test measured nothing');
  assert.equal(out.removed, true, JSON.stringify(out));
  assert.equal(holds(home, leaving), false, 'the forget did not take its entry back');
  if (landed) assert.ok(holds(home, arriving), 'the trust reported success and its entry was lost by the forget\'s rename');
  else assert.equal(holds(home, arriving), false);
});

test('#5434: a forget with no codex folder answers as before and makes no lock', () => {
  const home = path.join(SANDBOX, 'absent-' + (++N));
  const out = create.forgetCodexFolder(folder(), home);
  assert.deepEqual(out, { ok: true, removed: false, because: 'there is no codex config to change' });
  assert.equal(fs.existsSync(home), false, 'the forget made a codex folder');
});

test('#5434: a flush that fails refuses the trust and releases the lock', () => {
  const home = freshHome();
  const dir = folder();
  const realFsync = fs.fsyncSync;
  fs.fsyncSync = () => { const e = new Error('EIO: i/o error, fsync'); e.code = 'EIO'; throw e; };
  try { assert.throws(() => create.trustCodexFolder(dir, home), /EIO/); }
  finally { fs.fsyncSync = realFsync; }
  assert.equal(fs.existsSync(cfgOf(home) + '.lock'), false, 'a failed trust left config.toml.lock behind');
});

test('#5434: a re-trust of a folder already trusted answers at once, even with the lock held', () => {
  const home = freshHome();
  const dir = folder();
  create.trustCodexFolder(dir, home);
  const before = fs.readFileSync(cfgOf(home), 'utf8');
  fs.mkdirSync(cfgOf(home) + '.lock'); // a live holder
  try { noWait(() => create.trustCodexFolder(dir, home)); }
  finally { fs.rmdirSync(cfgOf(home) + '.lock'); }
  assert.equal(fs.readFileSync(cfgOf(home), 'utf8'), before);
});

test('#5434: a config.toml the trust creates is 0600, and an existing one keeps its mode', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const prev = process.umask(0o022);
  try {
    const home = freshHome();
    create.trustCodexFolder(folder(), home);
    assert.equal(fs.statSync(cfgOf(home)).mode & 0o777, 0o600, 'a new config.toml beside auth.json was created readable by others');
    fs.chmodSync(cfgOf(home), 0o640);
    create.trustCodexFolder(folder(), home);
    assert.equal(fs.statSync(cfgOf(home)).mode & 0o777, 0o640, 'the append changed an existing file\'s mode');
  } finally { process.umask(prev); }
});
