'use strict';
/**
 * kosmos#5434 slice 2: the provider account stores save a key, and Claude's settings.json, through
 * securewrite.writeSecret, so the bytes are flushed to disk BEFORE the rename makes them the file
 * (a crash could otherwise leave a full-length, zero-filled key or settings file, #5431).
 * Every arm writes in its own scratch folder.
 *
 *   node --test engine/accounts.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const claude = require('./claudeaccounts');
const grok = require('./grokaccounts');
const gemini = require('./geminiaccounts');

/* Record each fsync (with the path of the fd, from the open that returned it) and each rename, in
   order, while `fn` runs; put fs back afterwards. */
function recording(fn) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (target, ...rest) => { const fd = realOpen.call(fs, target, ...rest); fdPath.set(fd, String(target)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  try { fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return events;
}

/* The rename into `target` came from a temp that was flushed before it. */
function flushedBeforeRename(events, target) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === target);
  assert.ok(r >= 0, 'no rename into ' + target + ': ' + JSON.stringify(events));
  const tmp = events[r][1];
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === tmp),
    'the temp renamed into ' + path.basename(target) + ' was never flushed before the rename: ' + JSON.stringify(events));
}

/* A pid with no process: the highest pid the OS hands out is far below this. Checked in each arm
   that relies on it, not assumed. */
const DEAD_PID = 2147483646;

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct5434-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const [name, mod] of [['claude', claude], ['grok', grok], ['gemini', gemini]]) {
  test('#5434: ' + name + ' storeKey flushes the key before the rename, and it reads back exactly', (t) => {
    const dir = path.join(scratch(t), 'acct');
    fs.mkdirSync(dir);
    const events = recording(() => mod.storeKey(dir, '  sk-test-5434-' + name + '  '));
    const file = mod.keyFile(dir);
    flushedBeforeRename(events, file);
    assert.equal(fs.readFileSync(file, 'utf8'), 'sk-test-5434-' + name);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  test('#5434: ' + name + ' forgetKey removes a writeSecret temp a dead writer left, and leaves a live one', (t) => {
    const dir = path.join(scratch(t), 'acct');
    fs.mkdirSync(dir);
    mod.storeKey(dir, 'sk-kept');
    assert.throws(() => process.kill(DEAD_PID, 0), (e) => e.code === 'ESRCH');
    const base = mod.keyFile(dir) + '.kosmos-';
    const dead = base + DEAD_PID + '-t0-1-1.tmp';      // a writer that died between create and rename
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    t.after(() => child.kill());
    assert.ok(Number.isInteger(child.pid), 'the live-writer child did not start, so this arm would test nothing');
    const live = base + child.pid + '-t0-1-1.tmp';     // a live foreign writer (a child we hold open): never taken
    fs.writeFileSync(dead, 'raw-key', { mode: 0o600 });
    fs.writeFileSync(live, 'raw-key', { mode: 0o600 });
    assert.equal(mod.forgetKey(dir), true);
    assert.equal(fs.existsSync(mod.keyFile(dir)), false);
    assert.equal(fs.existsSync(dead), false, 'a dead writer\'s temp holding the key outlived forgetKey');
    assert.equal(fs.existsSync(live), true, 'a live writer\'s temp was deleted');
  });

  test('#5434: ' + name + ' storeKey still removes a stale <keyfile>.tmp an older version left', (t) => {
    const dir = path.join(scratch(t), 'acct');
    fs.mkdirSync(dir);
    const stale = mod.keyFile(dir) + '.tmp';
    fs.writeFileSync(stale, 'old-raw-key', { mode: 0o600 });
    mod.storeKey(dir, 'sk-new');
    assert.equal(fs.existsSync(stale), false, 'a stale temp holding a raw key was left behind');
  });
}

test('#5434: claude wireApiKeyHelper and unwireApiKeyHelper flush settings.json before the rename', (t) => {
  const root = scratch(t);
  const settings = path.join(root, '.claude', 'settings.json');
  const wired = recording(() => assert.deepEqual(claude.wireApiKeyHelper(settings, root), { wired: true }));
  flushedBeforeRename(wired, settings);
  const obj = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(obj.apiKeyHelper, claude.apiKeyHelperCommand(root));
  const unwired = recording(() => assert.deepEqual(claude.unwireApiKeyHelper(settings), { unwired: true }));
  flushedBeforeRename(unwired, settings);
  assert.equal('apiKeyHelper' in JSON.parse(fs.readFileSync(settings, 'utf8')), false);
});

test('#5434: settings.json keeps the mode it had, never writable by others; a new one is 0600 whatever the umask', { skip: process.platform === 'win32' && 'POSIX modes' }, (t) => {
  const root = scratch(t);
  const settings = path.join(root, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }) + '\n');
  fs.chmodSync(settings, 0o600);
  claude.wireApiKeyHelper(settings, root);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o600, 'a 0600 settings.json was loosened on save');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).theme, 'dark', 'another setting was lost');
  claude.unwireApiKeyHelper(settings);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o600);
  fs.chmodSync(settings, 0o644);
  claude.wireApiKeyHelper(settings, root);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o644, 'a 0644 settings.json did not keep its mode');
  fs.chmodSync(settings, 0o666);
  claude.unwireApiKeyHelper(settings);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o644, 'a world-writable settings.json stayed writable by others');
  fs.chmodSync(settings, 0o440);
  claude.wireApiKeyHelper(settings, root);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o640, 'group read was not kept, or owner write not added');
  fs.chmodSync(settings, 0o400);
  claude.wireApiKeyHelper(settings, root);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o600, 'an owner-unwritable settings.json stayed that way');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).theme, 'dark', 'another setting was lost');
  const fresh = path.join(root, 'fresh', 'settings.json');
  const prev = process.umask(0o022);
  try { claude.wireApiKeyHelper(fresh, root); } finally { process.umask(prev); }
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
});

test('#5434: when every atomic attempt fails, a settings save throws and leaves settings.json as it was', (t) => {
  const root = scratch(t);
  const settings = path.join(root, 'settings.json');
  const before = JSON.stringify({ theme: 'dark', model: 'x' }) + '\n';
  fs.writeFileSync(settings, before);
  const realOpen = fs.openSync;
  fs.openSync = (target, flags, ...rest) => {
    if (flags === 'wx') throw Object.assign(new Error('planted'), { code: 'EEXIST' });   // every atomic attempt fails
    return realOpen.call(fs, target, flags, ...rest);
  };
  try {
    assert.throws(() => claude.wireApiKeyHelper(settings, root), (e) => e.code === 'EEXIST');
  } finally { fs.openSync = realOpen; }
  assert.equal(fs.readFileSync(settings, 'utf8'), before, 'settings.json was rewritten in place');
});

test('#5434: CONTROL, a key save under the same failure still takes the in-place fallback', (t) => {
  const dir = path.join(scratch(t), 'acct');
  fs.mkdirSync(dir);
  const realOpen = fs.openSync;
  fs.openSync = (target, flags, ...rest) => {
    if (flags === 'wx') throw Object.assign(new Error('planted'), { code: 'EEXIST' });
    return realOpen.call(fs, target, flags, ...rest);
  };
  try { claude.storeKey(dir, 'sk-fallback'); } finally { fs.openSync = realOpen; }
  assert.equal(fs.readFileSync(claude.keyFile(dir), 'utf8'), 'sk-fallback');
});
