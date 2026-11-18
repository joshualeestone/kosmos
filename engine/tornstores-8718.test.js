'use strict';
/**
 * kosmos#8718: a store a crash left empty or all zero bytes is moved aside at start-up (engine/tornstores.js), logged
 * one line per file, and then reads as absent, so its reader takes its default. This test process's store is a
 * throwaway (#5418 ask 1).
 *
 *   node --test engine/tornstores-8718.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'tornstores-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const store = require('./store');
const torn = require('./tornstores');

const OLD = Date.now() - 60 * 1000;   // a crash's file: older than the restart
function put(root, rel, bytes, mtime = OLD) {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, bytes);
  fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}
function freshRoot(name) {
  const r = path.join(SB, name);
  fs.mkdirSync(r, { recursive: true });
  return r;
}

test('each torn shape is moved aside, logged once, and recorded; everything else stays', () => {
  const root = freshRoot('shapes');
  const good = put(root, 'settings.json', '{"a":1}\n');
  const damaged = put(root, 'projects.json', '{"half":');            // real but damaged: not a crash artifact
  const emptyLog = put(root, 'created.jsonl', '');                   // an empty log is an ordinary empty log
  put(root, 'phone-chat-opens.json', '');                            // empty .json
  put(root, 'liveness/ava.json', Buffer.alloc(300));                 // all zeros, nested
  put(root, 'messages.jsonl', Buffer.alloc(4096 * 20));              // all zeros .jsonl, past one read chunk
  put(root, 'sendertokens/ava.json', Buffer.alloc(64));              // a token file: named louder
  const partZero = put(root, 'heartbeat.json', Buffer.concat([Buffer.alloc(70000), Buffer.from('{}')]));   // zeros, then content
  const recent = put(root, 'board-alive.json', '', Date.now());      // a live writer's moment: left alone
  const personal = put(root, 'attachments/x/record.json', '');       // a person's folder: never scanned
  const notStore = put(root, 'victim.txt', Buffer.alloc(10));        // not a store

  const lines = [];
  const out = torn.run(root, { log: (l) => lines.push(l) });

  const moved = out.moved.map((m) => m.rel).sort();
  assert.deepEqual(moved, ['liveness/ava.json', 'messages.jsonl', 'phone-chat-opens.json', 'sendertokens/ava.json']);
  assert.deepEqual(out.failed, []);
  assert.equal(lines.length, 4, 'one line per moved file');
  for (const m of out.moved) {
    assert.equal(fs.existsSync(path.join(root, ...m.rel.split('/'))), false, m.rel + ' is gone from its place');
    const kept = path.join(root, ...m.movedTo.split('/'));
    assert.equal(fs.existsSync(kept), true, m.rel + ' is kept under torn/');
    assert.ok(lines.some((l) => l.includes(m.rel) && l.includes(m.movedTo)), 'the log names ' + m.rel + ' and where it went');
  }
  assert.ok(lines.find((l) => l.includes('sendertokens/ava.json')).includes('key or token'), 'a token file is named louder');
  assert.ok(!lines.find((l) => l.includes('liveness/ava.json')).includes('key or token'));
  // the kept bytes are the torn bytes, untouched
  assert.equal(fs.readFileSync(path.join(root, ...out.moved.find((m) => m.rel === 'messages.jsonl').movedTo.split('/'))).length, 4096 * 20);

  const rec = JSON.parse(fs.readFileSync(path.join(root, ...out.folder.split('/'), 'reset.json'), 'utf8'));
  assert.deepEqual(rec.moved.map((m) => m.rel).sort(), moved);
  assert.equal(torn.lastRun(), out);

  for (const f of [good, damaged, emptyLog, partZero, recent, personal, notStore]) assert.equal(fs.existsSync(f), true, f + ' stays');
  assert.equal(fs.readFileSync(good, 'utf8'), '{"a":1}\n');

  // a second start finds nothing more and makes no folder
  const again = torn.run(root, { log: (l) => lines.push(l) });
  assert.deepEqual(again.moved, []);
  assert.equal(again.folder, null);
  assert.equal(lines.length, 4);
});

test('a clean data folder: nothing moved, no torn folder, no log line', () => {
  const root = freshRoot('clean');
  put(root, 'settings.json', '{}');
  put(root, 'created.jsonl', '{"a":1}\n');
  const lines = [];
  const out = torn.run(root, { log: (l) => lines.push(l) });
  assert.deepEqual(out.moved, []);
  assert.equal(lines.length, 0);
  assert.equal(fs.existsSync(path.join(root, torn.TORN_DIR)), false);
});

test('a missing data folder does not throw', () => {
  const out = torn.run(path.join(SB, 'nope'), { log: () => {} });
  assert.deepEqual(out.moved, []);
});

/* The harm the card names: a reader that fails CLOSED on an unparseable store holds its feature off. Phone notices are
   one: a zero-filled phone-notify.json reads as 'off' forever. After the start-up check it reads as 'unset', which is
   the state the default-on path acts on. Run in the real store root of this (throwaway) process. */
test('a real reader that failed closed on the torn store takes its default afterwards', () => {
  const remote = require('./remote');
  const pn = require('./phonenotify');
  const f = path.join(remote.stateDir(), 'phone-notify.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(512));
  fs.utimesSync(f, OLD / 1000, OLD / 1000);
  assert.equal(pn.masterChoice(), 'off', 'control: the zeroed file holds phone notices off');
  const out = torn.run(store.ROOT, { log: () => {} });
  assert.ok(out.moved.some((m) => m.rel.endsWith('phone-notify.json')), 'the zeroed file was moved');
  assert.equal(pn.masterChoice(), 'unset', 'and the reader now takes its default');
});

/* Wiring: the board itself runs the check at start-up, before it serves. A real `node server.js` would start a
   board, so this reads the source for the call, and runs the module the way the call does. */
test('server.js runs the check at start-up, on the store root, inside the board-only block', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("require('./engine/tornstores').run(require('./engine/store').ROOT)");
  assert.ok(at > 0, 'server.js calls tornstores.run on store.ROOT');
  const block = src.lastIndexOf('if (require.main === module) {', at);
  assert.ok(block > 0 && src.indexOf('logring.board.tap(process.stderr', block) < at, 'after the log stamp and ring, in the board-only block');
  assert.ok(src.indexOf('\n}', block) > at, 'inside that block');
  assert.ok(at < src.indexOf("require('./engine/slowspawn')"), 'before the other engine modules start');
});

/* A writer killed mid-save leaves the old file or the new one, never a torn one: store.saveFlushed (#5434) writes a
   temp, flushes it, and renames. A child is killed with SIGKILL while saving in a loop; the file must always parse.
   What this can and cannot see: a SIGKILL ends the process, not the machine, so the page cache survives and this proves
   the temp-then-rename half (no reader ever sees a half-written file). The flush half, which is what a power loss
   needs, is pinned by the order of fsync and rename in engine/*fsync-5434.test.js; no test here can cut the power. */
test('a kill during a flushed save leaves a whole file', { skip: process.platform === 'win32' }, () => {
  const dir = freshRoot('kill');
  const f = path.join(dir, 'state.json');
  fs.writeFileSync(f, JSON.stringify({ n: 0, pad: 'x'.repeat(20000) }));
  const child = `
    process.env.AGENT_WORKFORCE_DATA = ${JSON.stringify(path.join(SB, 'killdata'))};
    const store = require(${JSON.stringify(path.join(__dirname, 'store.js'))});
    const f = ${JSON.stringify(f)};
    for (let n = 1; ; n++) store.saveFlushed(f, JSON.stringify({ n, pad: 'x'.repeat(20000 + (n % 997)) }));
  `;
  for (let i = 0; i < 5; i++) {
    const r = spawnSync(process.execPath, ['-e', child], { timeout: 150 + i * 37, killSignal: 'SIGKILL' });
    assert.equal(r.signal, 'SIGKILL', 'the writer was killed mid-loop, not finished');
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(typeof parsed.n, 'number');
  }
});
