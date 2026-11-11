'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)
/**
 * kosmos#5434 slice 11: setup-assistant.js saves the guard's Claude Code settings files through
 * securewrite.writeSecret (saveSettingsFile), so the bytes are flushed to disk BEFORE the rename makes them the file
 * (#5431): the guide's .claude/settings.json (guardGuideFolder), and a token-only agent's .claude/settings.json and
 * settings.local.json (guardTokenOnlyFolder). Each keeps an existing file's mode, refuses a save whose every atomic
 * attempt fails and leaves the file as it was, never writes through a link planted at the temp name, and reaps
 * only its own dead temps.
 *
 *   node --test engine/setupsettings.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'setupsettings-fsync-5434-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const setup = require('./setup-assistant');
const store = require('./store');
fs.mkdirSync(store.ROOT, { recursive: true });
/* As engine/boardkeychain-4491.test.js: the launch-PATH part of the guard pinned empty, so this never reads the host's. */
/* kosmos#8368: env pinned too, so the shell-start and plugin-variable scans (the parts of the guard that read deps.env)
   never read the host's environment. Not the cause of the Windows failure (that is the ancestor imports below); it
   keeps one more host input out. */
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude',
  panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [],
  env: { PATH: '' } };

let N = 0;
function fresh(name) { const d = path.join(SANDBOX, 'workers', name + '-' + (++N)); fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); return d; }

/* kosmos#8368: the token-only guard also covers what the instruction files ABOVE the agent's folder import (Claude Code
   walks up from its cwd). On Windows the temp folder sits inside the person's home, so a person whose own
   ~/.claude/CLAUDE.md imports files the permission rules cannot carry makes every sandbox here report ok:false: the
   guard is right, the host is not clean. Asked once, of the guard itself, on a throwaway folder: when EVERY complaint it
   makes is that kind (each entry's note is exactly the import note, nothing else, no PATH part), the arms that need a
   clean "ok" skip, with its words. Anything else, a second complaint of any kind or a path with its own brackets,
   runs the arms and fails loudly. Never on CI: a runner's home is clean, so a skip there would only hide a fault. */
const IMPORT_NOTE = '(a file an instruction file imports, whose path the permission rules cannot carry)';
const COVER_PREFIX = 'a file or folder Claude Code reads at start could not be covered (';
function onlyImportComplaints(reason) {
  let s = String(reason || '');
  if (!s.startsWith(COVER_PREFIX)) return false;
  s = s.slice(COVER_PREFIX.length).replace(/\): renaming that folder[\s\S]*$/, ')').replace(/\)$/, '');
  const notes = s.match(/\([^()]*\)/g) || [];
  return notes.length > 0 && notes.every((n) => n === IMPORT_NOTE) && !/[()]/.test(s.replace(/\([^()]*\)/g, ''));
}
const HOST_NOT_CLEAN = (() => {
  if (process.env.GITHUB_ACTIONS === 'true') return false;
  const d = fresh('hostcheck');
  fs.writeFileSync(path.join(d, '.claude', 'settings.json'), '{}\n');
  let r;
  try { r = setup.guardTokenOnlyFolder(d, path.basename(d), DEPS); } catch { return false; }
  if (!r || r.ok !== false || r.pathReason || !onlyImportComplaints(r.otherReason)) return false;
  const why = String(r.otherReason);
  return `this computer's own instruction files, above every temp folder, import files the guard cannot cover (${why.length > 160 ? why.slice(0, 160) + '...' : why}), so the token-only guard cannot answer ok here`;
})();
const writeJson = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode: 0o644 });
const sandboxOf = (file) => (JSON.parse(fs.readFileSync(file, 'utf8')).sandbox || {});

/* Each writer as a fixture: make() leaves the next save() something to write; save() answers true when the guard
   reported success; wrote() says whether the change landed in THIS file. */
const WRITERS = [
  {
    name: 'guide .claude/settings.json (guardGuideFolder)',
    make() {
      const dir = fresh('guide');
      const file = path.join(dir, '.claude', 'settings.json');
      writeJson(file, { theirs: true });
      return { file, folder: path.dirname(file),
        save: () => setup.guardGuideFolder(dir, 'guide-' + N, { platform: 'darwin' }).ok === true,
        wrote: () => sandboxOf(file).enabled === true };
    },
  },
  {
    name: 'token-only .claude/settings.json (guardTokenOnlyFolder)',
    hostBound: true,
    make() {
      const dir = fresh('pilot');
      const file = path.join(dir, '.claude', 'settings.json');
      writeJson(file, { theirs: true });
      const name = path.basename(dir);
      return { file, folder: path.dirname(file),
        save: () => setup.guardTokenOnlyFolder(dir, name, DEPS).ok === true,
        wrote: () => Array.isArray((sandboxOf(file).filesystem || {}).denyRead) };
    },
  },
  {
    name: 'token-only .claude/settings.local.json (cleanLocalSettings)',
    hostBound: true,
    make() {
      const dir = fresh('pilotlocal');
      const file = path.join(dir, '.claude', 'settings.local.json');
      writeJson(file, { sandbox: { enabled: false }, theirs: true });   // a key that would undo the guard
      const name = path.basename(dir);
      return { file, folder: path.dirname(file),
        save: () => setup.guardTokenOnlyFolder(dir, name, DEPS).ok === true,
        wrote: () => sandboxOf(file).enabled === undefined && JSON.parse(fs.readFileSync(file, 'utf8')).theirs === true };
    },
  },
];

const isTemp = (file, p) => String(p).startsWith(file + '.kosmos-') && /\.kosmos-\d+-(?:t\d+-)?\d+-\d+\.tmp$/.test(String(p));

for (const W of WRITERS) {
  /* The arms whose answer the host's own imports decide: the ones that need "ok", and the two that expect a refusal
     (on an unclean host the guard refuses anyway, so those would pass without testing the flush or the attempts). */
  const needsCleanOk = { skip: (W.hostBound && HOST_NOT_CLEAN) || false };
  test(`#5434 ${W.name}: the temp renamed into the file is flushed first`, needsCleanOk, () => {
    const { file, save, wrote } = W.make();
    const events = [];
    const fdPath = new Map();
    const realOpen = fs.openSync;
    const realFsync = fs.fsyncSync;
    const realRename = fs.renameSync;
    fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
    fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
    fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
    let ok;
    try { ok = save(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
    assert.equal(ok, true, 'the save did not happen');
    assert.equal(wrote(), true, 'the change did not land');
    const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
    assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
    assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), 'the temp was never flushed before its rename: ' + JSON.stringify(events));
  });

  test(`#5434 ${W.name}: the mode is kept under a umask the fd's mode set must undo`, { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
    const { file, save } = W.make();
    fs.chmodSync(file, 0o640);
    const prev = process.umask(0o077);
    let ok;
    try { ok = save(); } finally { process.umask(prev); }
    assert.equal(ok, true, 'the save did not happen');
    assert.equal(fs.statSync(file).mode & 0o777, 0o640, 'the mode was not kept');
  });

  test(`#5434 ${W.name}: when every atomic attempt fails the save is refused and the file is left as it was`, needsCleanOk, () => {
    const { file, save } = W.make();
    const before = fs.readFileSync(file);
    const realOpen = fs.openSync;
    let refused = 0;
    fs.openSync = (p, flags, ...rest) => {
      if (flags === 'wx' && isTemp(file, p)) { refused += 1; const e = new Error('injected'); e.code = 'EEXIST'; throw e; }
      return realOpen.call(fs, p, flags, ...rest);
    };
    let ok;
    try { ok = save(); } finally { fs.openSync = realOpen; }
    assert.ok(refused >= 3, 'the save did not make its atomic attempts, so this did not test the failure');
    assert.equal(ok, false, 'a save that never landed was reported as done');
    assert.deepEqual(fs.readFileSync(file), before, 'a failed save changed the file');
  });

  test(`#5434 ${W.name}: a link planted at the temp name is not written through or removed`, { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
    const { file, save, wrote } = W.make();
    const elsewhere = path.join(SANDBOX, 'elsewhere-' + (++N));
    const realOpen = fs.openSync;
    let planted = null;
    fs.openSync = (p, flags, ...rest) => {
      if (planted === null && flags === 'wx' && isTemp(file, p)) { planted = String(p); fs.symlinkSync(elsewhere, planted); }
      return realOpen.call(fs, p, flags, ...rest);
    };
    let ok;
    let linkKept = false;
    try { ok = save(); } finally {
      fs.openSync = realOpen;
      try { linkKept = fs.lstatSync(planted).isSymbolicLink(); } catch { linkKept = false; }
      if (planted) fs.rmSync(planted, { force: true });
    }
    assert.ok(planted, 'the plant never happened, so this tests nothing');
    assert.equal(fs.existsSync(elsewhere), false, 'the file was written through the planted link');
    assert.equal(linkKept, true, 'the planted link was removed');
    assert.equal(ok, true, 'the save did not move on to a fresh name');
    assert.equal(wrote(), true, 'the change did not land');
    assert.equal(fs.lstatSync(file).isSymbolicLink(), false, 'the file became a link');
  });

  test(`#5434 ${W.name}: only this file's own dead temps are reaped`, needsCleanOk, () => {
    const { file, save, folder } = W.make();
    // pid 2147483646 is chosen because it cannot be live (a dead writer); do not change it to process.pid
    const mine = file + '.kosmos-2147483646-t0-1-1.tmp';
    const other = path.join(folder, 'other.json.kosmos-2147483646-t0-1-1.tmp');
    const live = file + '.kosmos-' + process.pid + '-t999-1-1.tmp';   // this process is alive: another writer's
    for (const p of [mine, other, live]) fs.writeFileSync(p, 'x');
    assert.equal(save(), true, 'the save did not happen');
    assert.equal(fs.existsSync(mine), false, 'the file\'s own dead temp was not reaped');
    assert.equal(fs.existsSync(other), true, 'another file\'s temp was swept: a folder-wide sweep of the person\'s folder');
    assert.equal(fs.existsSync(live), true, 'a live writer\'s temp was reaped');
  });

  test(`#5434 ${W.name}: a flush that fails refuses the save, leaves the file, and leaves no temp`, needsCleanOk, () => {
    const { file, save } = W.make();
    const before = fs.readFileSync(file);
    const realOpen = fs.openSync;
    const realFsync = fs.fsyncSync;
    const temps = new Map();
    let failed = 0;
    fs.openSync = (p, flags, ...rest) => {
      const fd = realOpen.call(fs, p, flags, ...rest);
      if (flags === 'wx' && isTemp(file, p)) temps.set(fd, String(p));
      return fd;
    };
    fs.fsyncSync = (fd) => {
      if (temps.has(fd)) { failed += 1; const e = new Error('injected'); e.code = 'EIO'; throw e; }
      return realFsync(fd);
    };
    let ok;
    try { ok = save(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; }
    assert.ok(failed >= 1, 'the flush of the temp was never reached, so this tests nothing');
    assert.equal(ok, false, 'a save whose flush failed was reported as done');
    assert.deepEqual(fs.readFileSync(file), before, 'a save whose flush failed changed the file');
    for (const t of temps.values()) assert.equal(fs.existsSync(t), false, 'a temp it created was left behind: ' + t);
  });
}

/* Review 1: a guard file is never left writable by other accounts, and never takes a link target's mode. */
for (const W of WRITERS) {
  test(`#5434 ${W.name}: a world-writable file is narrowed, not kept`, { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
    const { file, save } = W.make();
    fs.chmodSync(file, 0o666);
    const prev = process.umask(0o022);
    let ok;
    try { ok = save(); } finally { process.umask(prev); }
    assert.equal(ok, true, 'the save did not happen');
    assert.equal(fs.statSync(file).mode & 0o7777, 0o644, 'group/other write was kept on the guard file');
  });

  test(`#5434 ${W.name}: a file that is a link takes the default mode, not its target's`, { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
    const { file, save } = W.make();
    const target = path.join(SANDBOX, 'linked-' + (++N) + '.json');
    fs.renameSync(file, target);
    fs.chmodSync(target, 0o777);
    fs.symlinkSync(target, file);
    const prev = process.umask(0o022);
    let ok;
    try { ok = save(); } finally { process.umask(prev); }
    assert.equal(ok, true, 'the save did not happen');
    assert.equal(fs.lstatSync(file).isFile(), true, 'the link was not replaced by the guard file');
    assert.equal(fs.statSync(file).mode & 0o7777, 0o644, 'the guard file took the link target\'s mode');
  });
}

/* Review 2: the special bits never survive onto a guard file. */
for (const W of WRITERS) {
  test(`#5434 ${W.name}: setuid and setgid bits are dropped`, { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
    const { file, save } = W.make();
    fs.chmodSync(file, 0o6644);
    assert.equal(save(), true, 'the save did not happen');
    assert.equal(fs.statSync(file).mode & 0o7777, 0o644, 'a special bit survived on the guard file');
  });
}
