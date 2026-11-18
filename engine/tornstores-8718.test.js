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
  const download = put(root, 'downloads/a.json', '');
  const otherWorld = put(root, 'worlds/w1/projects/p/a.json', '');    // another Kosmos's project folder
  const otherStore = put(root, 'worlds/w1/Kosmos/settings.json', Buffer.alloc(40));   // and its own data root
  const deep = put(root, 'a/b/c/d/e.json', '');                      // past MAX_DEPTH
  put(root, 'a/b/c/x.json', '');                                     // control: at the limit, three folders down, IS moved
  const notStore = put(root, 'victim.txt', Buffer.alloc(10));        // not a store

  const lines = [];
  const out = torn.run(root, { log: (l) => lines.push(l) });

  const moved = out.moved.map((m) => m.rel).sort();
  assert.deepEqual(moved, ['a/b/c/x.json', 'liveness/ava.json', 'messages.jsonl', 'phone-chat-opens.json', 'sendertokens/ava.json']);
  assert.deepEqual(out.failed, []);
  assert.equal(lines.length, 5, 'one line per moved file');
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

  for (const f of [good, damaged, emptyLog, partZero, recent, personal, download, otherWorld, otherStore, deep]) assert.equal(fs.existsSync(f), true, f + ' stays');
  assert.equal(fs.readFileSync(good, 'utf8'), '{"a":1}\n');

  // a second start finds nothing more and makes no folder
  const again = torn.run(root, { log: (l) => lines.push(l) });
  assert.deepEqual(again.moved, []);
  assert.equal(again.folder, null);
  assert.equal(lines.length, 5);
});

/* Making a symlink needs elevation on Windows (as dmfiles.folder-8617.test.js says), so these arms are POSIX only. */
test('a symlink to a torn store, and a symlinked folder, are never followed or moved', { skip: process.platform === 'win32' && 'symlinks need elevation on Windows' }, () => {
  const root = freshRoot('links');
  const outside = freshRoot('links-outside');
  const target = put(outside, 'target.json', Buffer.alloc(4096));    // torn (zeros longer than the link), reachable only through a link
  const link = path.join(root, 'link.json');
  fs.symlinkSync(target, link);
  fs.lutimesSync(link, OLD / 1000, OLD / 1000);                      // the link itself old too, so only lstat refuses it
  const inLinked = put(outside, 'dir/inside.json', Buffer.alloc(20));
  fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'linkdir'));
  const control = put(root, 'real.json', '');                        // control: a real torn file beside them IS moved
  const out = torn.run(root, { log: () => {} });
  assert.deepEqual(out.moved.map((m) => m.rel), ['real.json']);
  assert.equal(fs.existsSync(control), false);
  for (const f of [target, link, inLinked]) assert.equal(fs.existsSync(f), true, f + ' stays');
});

test('a scan answer naming a path outside the root moves nothing there', () => {
  const root = freshRoot('escape');
  const victim = put(SB, 'victim.json', '');
  const out = torn.run(root, { found: [{ rel: '../victim.json', shape: 'empty', size: 0, secret: false }], log: () => {} });
  assert.deepEqual(out.moved, []);
  assert.equal(fs.existsSync(victim), true);
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

test('a file made whole between the scan and the move is left where it is', () => {
  const root = freshRoot('stale');
  put(root, 'a.json', Buffer.alloc(30));
  put(root, 'b.json', '');
  const found = torn.scan(root);
  assert.equal(found.length, 2, 'control: both read as torn at scan time');
  const a = put(root, 'a.json', '{"whole":true}');                  // a writer lands its save after the scan
  const lines = [];
  const out = torn.run(root, { found, log: (l) => lines.push(l) });
  assert.deepEqual(out.moved.map((m) => m.rel), ['b.json']);
  assert.equal(fs.readFileSync(a, 'utf8'), '{"whole":true}', 'the whole file stays, untouched');
  assert.equal(lines.length, 1);
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

/* Wiring: the board runs the check once it holds its port, so a second launch that loses the port to a running board
   (onError) never moves that board's files. A real `node server.js` would start a board, so this reads the source. */
test('server.js runs the check on the store root, in onListening, only when it is the board', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const call = "require('./engine/tornstores').run(store.ROOT)";
  assert.equal(src.split(call).length, 2, 'server.js calls tornstores.run on store.ROOT exactly once');
  const at = src.indexOf(call);
  const listening = src.lastIndexOf('const onListening = () => {', at);
  const onError = src.lastIndexOf('const onError = (err) => {', at);
  assert.ok(listening > 0 && onError > 0 && onError < listening, 'inside onListening, not onError');
  const gate = src.lastIndexOf('if (require.main === module) {', at);
  assert.ok(gate > listening, 'behind the board-only gate inside onListening');
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
  let saved = 0;
  for (let i = 0; i < 5; i++) {
    const r = spawnSync(process.execPath, ['-e', child], { timeout: 600 + i * 97, killSignal: 'SIGKILL' });
    assert.equal(r.signal, 'SIGKILL', 'the writer was killed mid-loop, not finished');
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(typeof parsed.n, 'number');
    if (parsed.n > 0) saved++;
  }
  assert.ok(saved > 0, 'at least one round saved before its kill, so the kill landed while saves were happening');
});
