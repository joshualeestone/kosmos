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

test('#5434: settings.json keeps the mode it had; a new one is 0600 whatever the umask', { skip: process.platform === 'win32' && 'POSIX modes' }, (t) => {
  const root = scratch(t);
  const settings = path.join(root, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }) + '\n');
  fs.chmodSync(settings, 0o600);
  claude.wireApiKeyHelper(settings, root);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o600, 'a 0600 settings.json was loosened on save');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).theme, 'dark', 'another setting was lost');
  claude.unwireApiKeyHelper(settings);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o600);
  const fresh = path.join(root, 'fresh', 'settings.json');
  const prev = process.umask(0o022);
  try { claude.wireApiKeyHelper(fresh, root); } finally { process.umask(prev); }
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
});
