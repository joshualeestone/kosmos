'use strict';
/**
 * kosmos#8718: at start-up the board reports each store a crash left empty or all zero bytes (engine/tornstores.js),
 * one log line each and a record, and changes none of them, because "unreadable reads off" is a deliberate rule in
 * many readers. This test process's store is a throwaway (#5418 ask 1).
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

const OLD = Date.now() - 60 * 60 * 1000;   // a crash's file: well older than the restart, however long the suite runs
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
/* Every file under `dir` with its bytes, so a check can be shown to have changed none of them. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[path.relative(dir, p)] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return out;
}

test('each torn shape is reported once, nothing else is, and no store is changed', () => {
  const root = freshRoot('shapes');
  put(root, 'settings.json', '{"a":1}\n');
  put(root, 'projects.json', '{"half":');                            // real but damaged: not a crash artifact
  put(root, 'created.jsonl', '');                                    // an empty log is an ordinary empty log
  put(root, 'phone-chat-opens.json', '');                            // empty .json
  put(root, 'liveness/ava.json', Buffer.alloc(300));                 // all zeros, nested
  put(root, 'messages.jsonl', Buffer.alloc(4096 * 20));              // all zeros .jsonl, past one read chunk
  put(root, 'sendertokens/ava.json', Buffer.alloc(64));              // a token file: named louder
  put(root, 'heartbeat.json', Buffer.concat([Buffer.alloc(70000), Buffer.from('{}')]));   // zeros, then content
  put(root, 'board-alive.json', '', Date.now());                     // a live writer's moment: not looked at
  put(root, 'attachments/x/record.json', '');                        // a person's folder: never scanned
  put(root, 'downloads/a.json', '');
  put(root, 'worlds/w1/projects/p/a.json', '');                      // another Kosmos's project folder
  put(root, 'worlds/w1/Kosmos/settings.json', Buffer.alloc(40));     // and its own data root
  put(root, 'a/b/c/d/e.json', '');                                   // past MAX_DEPTH
  put(root, 'a/b/c/x.json', '');                                     // control: at the limit, three folders down, IS found
  put(root, 'victim.txt', Buffer.alloc(10));                         // not a store
  const before = snapshot(root);

  const lines = [];
  const out = torn.check(root, { log: (l) => lines.push(l) });

  const found = out.found.map((m) => m.rel).sort();
  assert.deepEqual(found, ['a/b/c/x.json', 'liveness/ava.json', 'messages.jsonl', 'phone-chat-opens.json', 'sendertokens/ava.json']);
  assert.equal(lines.length, 5, 'one line per torn file');
  for (const rel of found) assert.ok(lines.some((l) => l.includes(rel)), 'the log names ' + rel);
  assert.ok(lines.find((l) => l.includes('sendertokens/ava.json')).includes('key or token'), 'a token path is named louder');
  assert.ok(!lines.find((l) => l.includes('liveness/ava.json')).includes('key or token'));

  const after = snapshot(root);
  const recRel = path.join(torn.REPORT_DIR, torn.LAST_FILE);
  const rec = JSON.parse(Buffer.from(after[recRel], 'base64').toString('utf8'));
  assert.deepEqual(rec.found.map((m) => m.rel).sort(), found, 'the record names the same files');
  delete after[recRel];
  assert.deepEqual(after, before, 'every store is byte for byte as it was, and nothing was added beside them');
  assert.equal(torn.lastCheck(), out);
});

/* Making a symlink needs elevation on Windows (as dmfiles.folder-8617.test.js says), so these arms are POSIX only. */
test('a symlink to a torn store, and a symlinked folder, are never followed', { skip: process.platform === 'win32' && 'symlinks need elevation on Windows' }, () => {
  const root = freshRoot('links');
  const outside = freshRoot('links-outside');
  const target = put(outside, 'target.json', Buffer.alloc(4096));    // torn (zeros longer than the link), reachable only through a link
  const link = path.join(root, 'link.json');
  fs.symlinkSync(target, link);
  fs.lutimesSync(link, OLD / 1000, OLD / 1000);                      // the link itself old too, so only lstat refuses it
  put(outside, 'dir/inside.json', Buffer.alloc(20));
  fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'linkdir'));
  put(root, 'real.json', '');                                        // control: a real torn file beside them IS found
  const out = torn.check(root, { log: () => {} });
  assert.deepEqual(out.found.map((m) => m.rel), ['real.json']);
});

test('the record goes once nothing is torn, so a stale one never outlives the fix', () => {
  const root = freshRoot('stale');
  const f = put(root, 'a.json', '');
  torn.check(root, { log: () => {} });
  const rec = path.join(root, torn.REPORT_DIR, torn.LAST_FILE);
  assert.equal(fs.existsSync(rec), true, 'control: written while a.json is torn');
  if (process.platform !== 'win32') assert.equal(fs.statSync(rec).mode & 0o777, 0o600);
  fs.writeFileSync(f, '{}');
  const lines = [];
  const out = torn.check(root, { log: (l) => lines.push(l) });
  assert.deepEqual(out.found, []);
  assert.equal(lines.length, 0);
  assert.equal(fs.existsSync(rec), false);
});

test('a symlinked report folder is never written through or removed through', { skip: process.platform === 'win32' && 'symlinks need elevation on Windows' }, () => {
  const root = freshRoot('reportlink');
  const elsewhere = freshRoot('reportlink-elsewhere');
  fs.symlinkSync(elsewhere, path.join(root, torn.REPORT_DIR));
  put(root, 'a.json', '');
  const out = torn.check(root, { log: () => {} });
  assert.equal(out.found.length, 1, 'control: the torn store is still found and logged');
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing written through the link');
  const kept = put(elsewhere, torn.LAST_FILE, '{"theirs":true}');
  fs.writeFileSync(path.join(root, 'a.json'), '{}');
  torn.check(root, { log: () => {} });
  assert.equal(fs.readFileSync(kept, 'utf8'), '{"theirs":true}', 'nothing removed through the link');
});

test('a missing data folder does not throw', () => {
  const out = torn.check(path.join(SB, 'nope'), { log: () => {} });
  assert.deepEqual(out.found, []);
});

/* The reason this only reports. phone-notify-choice.json holds only { off: true }: its existing at all is the person's
   off (#6488), and phonenotify reads an unreadable one as off on purpose. A zeroed copy must still read as off after
   the start-up check; moving it aside (this module's first design) turned it back to 'unset', which the default-on
   path then turns on. Run in the real store root of this (throwaway) process. */
test('a person\'s zeroed phone-notice off still reads as off after the check', () => {
  const remote = require('./remote');
  const pn = require('./phonenotify');
  const choice = path.join(path.dirname(remote.FILE), 'phone-notify-choice.json');
  fs.mkdirSync(path.dirname(choice), { recursive: true });
  fs.writeFileSync(choice, Buffer.alloc(16));
  fs.utimesSync(choice, OLD / 1000, OLD / 1000);
  assert.equal(pn.masterChoice(), 'off', 'control: the zeroed choice file reads as the person\'s off');
  const out = torn.check(store.ROOT, { log: () => {} });
  assert.ok(out.found.some((m) => m.rel.endsWith('phone-notify-choice.json')), 'it is reported as torn');
  assert.equal(pn.masterChoice(), 'off', 'and still reads as off');
  assert.equal(fs.readFileSync(choice).length, 16, 'the file is where it was, as it was');
});

/* Wiring: the board runs the check once it holds its port, so a second launch that loses the port (onError) never
   scans. A real `node server.js` would start a board, so this reads the source. */
test('server.js runs the check on the store root, in onListening, only when it is the board', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const call = "require('./engine/tornstores').check(store.ROOT)";
  assert.equal(src.split(call).length, 2, 'server.js calls tornstores.check on store.ROOT exactly once');
  const at = src.indexOf(call);
  const listening = src.lastIndexOf('const onListening = () => {', at);
  const onError = src.lastIndexOf('const onError = (err) => {', at);
  assert.ok(listening > 0 && onError > 0 && onError < listening, 'after onError starts and inside onListening');
  const end = src.indexOf('\n    };', listening);
  assert.ok(end > at, 'before onListening ends');
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
