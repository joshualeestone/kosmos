'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 18: a conversation thread (append, a reaction, the reactions-told mark) and the DM seen-cursor save
 * through store.saveFlushed, so they are flushed before the rename makes them the file (#5431). A zero-filled thread
 * parses as no messages: the whole conversation would be gone.
 *
 *   node --test engine/chat.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'chat-fsync-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
const chat = require('./chat');
chat.resetForTests();
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

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
  let err = null;
  try { out = fn(); } catch (e) { err = e; } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out, err };
}
function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into ' + path.basename(file) + ': ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), path.basename(file) + ': the temp was not flushed before its rename');
}

let seq = 0;
const t = (n) => new Date(Date.UTC(2026, 8, 24, 12, 0, n)).toISOString();
function thread() {
  const agent = 'fs' + (++seq);
  chat.appendMessage(chat.DIRECT, agent, { text: 'hi', at: t(1), delivery: { state: 'placed' } });
  chat.appendMessage(chat.DIRECT, agent, { text: 'I shipped the fix', from: agent, at: t(2) });
  return agent;
}

test('#5434: appending to a thread is flushed before the rename', () => {
  const agent = thread();
  const file = chat.threadFile(chat.DIRECT, agent);
  const { events, err } = recording(() => chat.appendMessage(chat.DIRECT, agent, { text: 'thanks', at: t(3), delivery: { state: 'placed' } }));
  assert.equal(err, null, String(err));
  flushedBeforeRename(events, file);
  assert.equal(chat.readThread(chat.DIRECT, agent).messages.length, 3);
});

test('#5434: an append whose flush fails keeps the thread as it was', () => {
  const agent = thread();
  const file = chat.threadFile(chat.DIRECT, agent);
  const before = fs.readFileSync(file, 'utf8');
  const isTemp = (p) => p.startsWith(file + '.kosmos-') && p.endsWith('.tmp');
  const { events } = recording(() => chat.appendMessage(chat.DIRECT, agent, { text: 'lost?', at: t(3), delivery: { state: 'placed' } }), isTemp);
  assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1] || '')), 'the temp was never flushed, so this tests nothing');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a save whose flush failed changed the thread');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')), [], 'a temp was left beside the thread');
});

test('#5434: a reaction is flushed before the rename', () => {
  const agent = thread();
  const file = chat.threadFile(chat.DIRECT, agent);
  const { events, out } = recording(() => chat.reactDirect(agent, t(2), '👍'));
  assert.equal(out.ok, true, JSON.stringify(out));
  flushedBeforeRename(events, file);
});

test('#5434: the DM seen-cursor is flushed before the rename', () => {
  const agent = thread();
  const { events, err } = recording(() => chat.markDmSeen(agent, Date.parse(t(5))));
  assert.equal(err, null, String(err));
  const r = events.find((e) => e[0] === 'rename' && path.basename(e[2]) === 'dm-seen.json');
  assert.ok(r, 'no rename into dm-seen.json: ' + JSON.stringify(events));
  flushedBeforeRename(events, r[2]);
});
