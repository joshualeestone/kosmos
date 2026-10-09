'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 14: board.token is flushed before link() or rename() publishes it, and the folder after (#5431);
 * a zero-filled board.token (NUL bytes, which .trim() keeps) reads as no token, so ensureToken replaces it rather than
 * serving a token nobody holds.
 *
 *   node --test engine/boardauth.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'boardauth-fsync-')));
process.env.AGENT_WORKFORCE_DATA = SB;
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = require('./store');
const boardauth = require('./boardauth');

function fresh() {
  fs.mkdirSync(store.ROOT, { recursive: true });   // store.ROOT is a leaf under the data folder
  for (const n of fs.readdirSync(store.ROOT)) fs.rmSync(path.join(store.ROOT, n), { recursive: true, force: true });
}

function recording(fn, failFsyncOf) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realLink = fs.linkSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => {
    const p = fdPath.get(fd);
    events.push(['fsync', p]);
    if (failFsyncOf && p && failFsyncOf(p)) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    return realFsync(fd);
  };
  fs.linkSync = (a, b) => { events.push(['publish', String(a), String(b)]); return realLink(a, b); };
  fs.renameSync = (a, b) => { events.push(['publish', String(a), String(b)]); return realRename(a, b); };
  let out;
  let err = null;
  try { out = fn(); } catch (e) { err = e; } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.linkSync = realLink; fs.renameSync = realRename; }
  return { events, out, err };
}

test('#5434: a new board.token is flushed before link() publishes it, and the folder after', () => {
  fresh();
  const { events, out, err } = recording(() => boardauth.ensureToken());
  assert.equal(err, null, String(err));
  assert.match(out, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(boardauth.tokenPath(), 'utf8'), out);
  const p = events.findIndex((e) => e[0] === 'publish' && e[2] === boardauth.tokenPath());
  assert.ok(p >= 0, 'nothing published the token: ' + JSON.stringify(events));
  assert.ok(events.slice(0, p).some((e) => e[0] === 'fsync' && e[1] === events[p][1]), 'the temp was not flushed before it was published');
  if (process.platform !== 'win32') {
    assert.ok(events.slice(p + 1).some((e) => e[0] === 'fsync' && e[1] === store.ROOT), 'the folder was not flushed after');
  }
});

test('#5434: a zero-filled board.token reads as no token, and ensureToken replaces it', () => {
  fresh();
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(boardauth.tokenPath(), Buffer.alloc(64), { mode: 0o600 });   // what a crash after an unflushed write leaves
  assert.equal(boardauth.readToken(), null, 'NUL bytes were served as a token');
  assert.equal(boardauth.readTokenFrom(store.ROOT), null, 'readTokenFrom served NUL bytes as a token');
  const { events, out } = recording(() => boardauth.ensureToken());
  assert.match(out, /^[0-9a-f]{64}$/, 'no real token came back');
  assert.equal(fs.readFileSync(boardauth.tokenPath(), 'utf8'), out, 'the zero-filled file was not replaced');
  const p = events.findIndex((e) => e[0] === 'publish' && e[2] === boardauth.tokenPath() && e[1] !== boardauth.tokenPath());
  assert.ok(events.slice(0, Math.max(p, 0)).some((e) => e[0] === 'fsync' && e[1] === events[p][1]), 'the replacement was not flushed before it was published');
});

test('#5434: a flush that fails leaves no token published and no temp behind', () => {
  fresh();
  const isTemp = (p) => path.basename(p).startsWith('.' + boardauth.TOKEN_FILE + '.');
  const { events, err } = recording(() => boardauth.ensureToken(), isTemp);
  assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1])), 'the temp was never flushed, so this tests nothing');
  assert.ok(err, 'a token whose flush failed was published as if saved');
  assert.equal(fs.existsSync(boardauth.tokenPath()), false, 'a token was published unflushed');
  assert.deepEqual(fs.readdirSync(store.ROOT).filter(isTemp), [], 'a temp was left behind');
});

test('#5434: an existing real token is returned as is and not rewritten', () => {
  fresh();
  const first = boardauth.ensureToken();
  const { events, out } = recording(() => boardauth.ensureToken());
  assert.equal(out, first);
  assert.equal(events.filter((e) => e[0] === 'publish').length, 0, 'a good token was rewritten');
});
