'use strict';
/**
 * kosmos#5434 slice 7: forgetCodexFolder rewrites the person's `~/.codex/config.toml` through
 * securewrite.writeSecret, so the bytes are flushed to disk BEFORE the rename makes them the file (#5431), the
 * file keeps its mode (#1797), a save whose every atomic attempt fails is refused and leaves the file as it was,
 * a link planted at the temp name is never written through or removed, and in the person's folder only this
 * file's own dead temps are reaped.
 *
 *   node --test engine/create.codexfsync-5434.test.js
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every root create.js resolves at require time, in this file's own sandbox (as create.test.js does).
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'create-codexfsync-')));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd-user');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const create = require('./create');

let N = 0;
/* A codex home holding the person's own settings plus the trust entry Kosmos wrote for a fresh folder, so the
   next forgetCodexFolder has something to take back (and therefore writes). Answers what the forget needs. */
function trusted(home) {
  const dir = path.join(SANDBOX, 'work-' + (++N));
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(home, 'config.toml');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, 'model = "gpt-5"\n', { mode: 0o600 });
  const before = fs.readFileSync(cfg, 'utf8');
  create.trustCodexFolder(dir, home);
  assert.notEqual(fs.readFileSync(cfg, 'utf8'), before, 'the trust entry was not written, so the forget has nothing to take back');
  return { dir, cfg };
}
function freshHome() { const h = path.join(SANDBOX, 'codex-' + (++N)); fs.mkdirSync(h, { recursive: true }); return h; }
const forget = (home, dir) => create.forgetCodexFolder(dir, home);

function recording(fn) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (target, ...rest) => { const fd = realOpen.call(fs, target, ...rest); fdPath.set(fd, String(target)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out };
}

function withUmask(mask, fn) {
  const prev = process.umask(mask);
  try { return fn(); } finally { process.umask(prev); }
}

test('#5434: the forget flushes the temp it renames into config.toml', () => {
  const home = freshHome();
  const { dir, cfg } = trusted(home);
  const { events, out } = recording(() => forget(home, dir));
  assert.equal(out.removed, true, 'the forget took nothing back, so nothing was written: ' + JSON.stringify(out));
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === cfg);
  assert.ok(r >= 0, 'no rename into config.toml: ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]),
    'the temp renamed into config.toml was never flushed first: ' + JSON.stringify(events));
});

test('#5434: the forget keeps config.toml\'s mode, under a umask the fd\'s mode set must undo', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const home = freshHome();
  const { dir, cfg } = trusted(home);
  fs.chmodSync(cfg, 0o640);
  const out = withUmask(0o077, () => forget(home, dir));
  assert.equal(out.removed, true, 'the forget wrote nothing');
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o640, 'the mode was not kept');
});

test('#5434: when every atomic attempt fails, the forget is refused and config.toml is left as it was', () => {
  const home = freshHome();
  const { dir, cfg } = trusted(home);
  const before = fs.readFileSync(cfg);
  const realOpen = fs.openSync;
  let planted = 0;
  fs.openSync = (p, flags, ...rest) => {
    if (flags === 'wx' && String(p).startsWith(cfg + '.kosmos-')) { planted += 1; const e = new Error('injected'); e.code = 'EEXIST'; throw e; }
    return realOpen.call(fs, p, flags, ...rest);
  };
  let out;
  try { out = forget(home, dir); } finally { fs.openSync = realOpen; }
  assert.equal(planted, 3, 'the save did not make its three atomic attempts, so this did not test the failure');
  assert.equal(out.ok, false, 'a save that never landed was reported as done');
  assert.match(out.because, /could not update the codex config/);
  assert.deepEqual(fs.readFileSync(cfg), before, 'a failed save changed config.toml');
});

test('#5434: a link planted at the temp name is not written through or removed, and the save moves to a fresh name', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const home = freshHome();
  const { dir, cfg } = trusted(home);
  const elsewhere = path.join(SANDBOX, 'elsewhere-' + (++N) + '.toml');
  const realOpen = fs.openSync;
  let planted = null;
  fs.openSync = (p, flags, ...rest) => {
    if (planted === null && flags === 'wx' && String(p).startsWith(cfg + '.kosmos-')) { planted = String(p); fs.symlinkSync(elsewhere, planted); }
    return realOpen.call(fs, p, flags, ...rest);
  };
  let out;
  let linkKept = false;
  try { out = forget(home, dir); } finally {
    fs.openSync = realOpen;
    try { linkKept = fs.lstatSync(planted).isSymbolicLink(); } catch { linkKept = false; }
    if (planted) fs.rmSync(planted, { force: true });
  }
  assert.ok(planted, 'the plant never happened, so this tests nothing');
  assert.equal(fs.existsSync(elsewhere), false, 'the config was written through the planted link');
  assert.equal(linkKept, true, 'the planted link was removed');
  assert.equal(out.removed, true, 'the save did not move on to a fresh name');
  assert.equal(fs.lstatSync(cfg).isSymbolicLink(), false, 'config.toml became a link');
  assert.ok(!fs.readFileSync(cfg, 'utf8').includes('[projects.'), 'the entry was not taken back');   // the home's only entry
});

test('#5434: in the person\'s codex folder only config.toml\'s own dead temps are reaped', () => {
  const home = freshHome();
  const { dir, cfg } = trusted(home);
  // pid 2147483646 is chosen because it cannot be live (a dead writer); do not change it to process.pid
  const mine = cfg + '.kosmos-2147483646-t0-1-1.tmp';
  const other = path.join(home, 'auth.json.kosmos-2147483646-t0-1-1.tmp');   // another file's temp, beside the credentials
  fs.writeFileSync(mine, 'x');
  fs.writeFileSync(other, 'x');
  assert.equal(forget(home, dir).removed, true, 'the forget wrote nothing');
  assert.equal(fs.existsSync(mine), false, 'config.toml\'s own dead temp was not reaped');
  assert.equal(fs.existsSync(other), true, 'another file\'s temp was swept: a folder-wide sweep of the person\'s codex folder');
});
