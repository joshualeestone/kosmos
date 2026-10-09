'use strict';
/**
 * kosmos#5434 slice 16: installSupervisor flushes each staged copy (the supervisor every agent launches through, the
 * four report bridges, and the engine-path pointer) before the rename puts it in place, and the folder after (#5431).
 * A flush that fails refuses the install, leaves the installed supervisor as it was, and leaves no staging file.
 *
 *   node --test engine/create.supfsync-5434.test.js
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every root create.js resolves at require time, in this file's own sandbox (as create.test.js does).
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'create-supfsync-')));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd-user');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const create = require('./create');

function recording(fn, failFsyncOf) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => {
    const p = fdPath.get(fd);
    events.push(['fsync', p]);
    if (failFsyncOf && p && failFsyncOf(p)) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    return realFsync(fd);
  };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out };
}

test('#5434: the supervisor, each report bridge and the engine-path pointer are flushed before their renames, the folder after', () => {
  const { events, out } = recording(() => create.installSupervisor());
  assert.equal(out.ok, true, JSON.stringify(out));
  const bin = path.dirname(create.supervisorPath());
  const renames = events.filter((e) => e[0] === 'rename' && path.dirname(e[2]) === bin);
  assert.ok(renames.length >= 6, 'expected the supervisor, four bridges and engine-path: ' + JSON.stringify(renames));
  for (const r of renames) {
    const i = events.indexOf(r);
    assert.ok(events.slice(0, i).some((e) => e[0] === 'fsync' && e[1] === r[1]), path.basename(r[2]) + ' was not flushed before its rename');
  }
  if (process.platform !== 'win32') {
    const last = events.lastIndexOf(renames[renames.length - 1]);
    assert.ok(events.slice(last + 1).some((e) => e[0] === 'fsync' && e[1] === bin), 'the folder was not flushed after the renames');
  }
});

test('#5434: a flush that fails refuses the install, keeps the installed supervisor, and leaves no staging file', () => {
  assert.equal(create.installSupervisor().ok, true, 'setup: no supervisor installed');
  const sup = create.supervisorPath();
  fs.appendFileSync(sup, '# the installed copy\n');   // mark it, so a replacement would show
  const before = fs.readFileSync(sup, 'utf8');
  const isStaging = (p) => p === `${sup}.${process.pid}.new`;
  const { events, out } = recording(() => create.installSupervisor(), isStaging);
  assert.ok(events.some((e) => e[0] === 'fsync' && isStaging(e[1] || '')), 'the staging copy was never flushed, so this tests nothing');
  assert.equal(out.ok, false, 'an install whose flush failed was reported as done');
  assert.equal(fs.readFileSync(sup, 'utf8'), before, 'a staging copy whose flush failed replaced the supervisor');
  assert.deepEqual(fs.readdirSync(path.dirname(sup)).filter((n) => n.endsWith('.new')), [], 'a staging file was left');
});

test('#5434: the installed supervisor and bridges stay executable', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  assert.equal(create.installSupervisor().ok, true);
  assert.equal(fs.statSync(create.supervisorPath()).mode & 0o777, 0o755);
});

test('#5434: a failed flush of the engine-path pointer does not refuse the install and leaves no staging file', () => {
  assert.equal(create.installSupervisor().ok, true, 'setup');
  const bin = path.dirname(create.supervisorPath());
  const isPtr = (p) => p === path.join(bin, `engine-path.${process.pid}.new`);
  const { events, out } = recording(() => create.installSupervisor(), isPtr);
  assert.ok(events.some((e) => e[0] === 'fsync' && isPtr(e[1] || '')), 'the pointer was never flushed, so this tests nothing');
  assert.equal(out.ok, true, 'a best-effort pointer refused the install');
  assert.deepEqual(fs.readdirSync(bin).filter((n) => n.endsWith('.new')), [], 'the pointer\'s staging file was left');
});
