'use strict';
/**
 * #5418 ask 2: tools/cleanup-fixture-tokens-5418.js removes only what test runs left in the sender-token store:
 * a token file whose agent is neither on the board nor in the removal records and predates the cutoff, an old
 * temp, a dangling link. Never a live agent's file, never without a roster, never before a backup.
 * This file runs in a test process, so (#5418 ask 1) the store root is this process's throwaway, never the real one.
 *
 *   node --test tools.cleanup-fixture-tokens-5418.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const tool = require('./tools/cleanup-fixture-tokens-5418');

const DAY = 24 * 3600 * 1000;
const CUTOFF = Date.parse('2026-10-08T00:00:00Z');
const OLD = CUTOFF - 30 * DAY;
const NEW = CUTOFF + DAY;

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokclean-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('#5418: the plan keeps a live agent at any age and removes only old orphans, old temps and dangling links', () => {
  const live = new Set(['alice']);
  const entries = [
    { name: 'alice.json', isSymlink: false, mtimeMs: OLD },            // live, old: KEEP
    { name: 'fixture-a.json', isSymlink: false, mtimeMs: OLD },        // orphan, old: remove
    { name: 'fixture-b.json', isSymlink: false, mtimeMs: NEW },        // orphan, new: keep
    { name: 'x.json.kosmos-1-t0-1-1.tmp', isSymlink: false, mtimeMs: OLD },  // old temp: remove
    { name: 'y.json.kosmos-2-t0-1-1.tmp', isSymlink: false, mtimeMs: NEW },  // new temp: keep
    { name: 'planted.json', isSymlink: true, targetExists: false, mtimeMs: OLD },  // dangling: remove
    { name: 'linked.json', isSymlink: true, targetExists: true, mtimeMs: OLD },    // live link: keep
    { name: 'notes.txt', isSymlink: false, mtimeMs: OLD },             // other: keep
    { name: 'dir.json', other: true, isSymlink: false, mtimeMs: null }, // a folder named like a token: keep
  ];
  const plan = tool.planCleanup(entries, live, CUTOFF);
  assert.deepEqual(plan.remove.map((r) => r.name).sort(), ['fixture-a.json', 'planted.json', 'x.json.kosmos-1-t0-1-1.tmp']);
  assert.deepEqual(plan.keep.map((k) => k.name).sort(), ['alice.json', 'dir.json', 'fixture-b.json', 'linked.json', 'notes.txt', 'y.json.kosmos-2-t0-1-1.tmp']);
  assert.equal(plan.remove.length + plan.keep.length, entries.length, 'an entry was dropped from both lists');
  assert.equal(plan.remove.find((r) => r.name === 'fixture-a.json').key, 'fixture-a');
});

test('#5418: an unreadable or unknown-age file is never removed', () => {
  const plan = tool.planCleanup([{ name: 'odd.json', isSymlink: false, mtimeMs: null }], new Set(), CUTOFF);
  assert.deepEqual(plan.remove, []);
});

test('#5418: listEntries sees links without following them, and a folder as neither token nor temp', { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' }, (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'a.json'), '{}');
  fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, 'dangling.json'));
  fs.symlinkSync(path.join(dir, 'a.json'), path.join(dir, 'ok.json'));
  fs.mkdirSync(path.join(dir, 'd.json'));
  const byName = Object.fromEntries(tool.listEntries(dir).map((e) => [e.name, e]));
  assert.equal(byName['a.json'].isSymlink, false);
  assert.equal(byName['dangling.json'].isSymlink, true);
  assert.equal(byName['dangling.json'].targetExists, false);
  assert.equal(byName['ok.json'].targetExists, true);
  assert.equal(byName['d.json'].other, true);
  assert.equal(tool.planCleanup(tool.listEntries(dir), new Set(), Date.now() + DAY).keep.some((k) => k.name === 'd.json'), true);
});

test('#5418: the backup copies files with their modes and links as links, and never overwrites one', { skip: process.platform === 'win32' && 'POSIX modes and symlinks' }, (t) => {
  const root = scratch(t);
  const dir = path.join(root, 'tokens');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.json'), 'A', { mode: 0o600 });
  fs.symlinkSync('/nowhere', path.join(dir, 'l.json'));
  const dest = path.join(root, 'backup');
  tool.backup(dir, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'a.json'), 'utf8'), 'A');
  assert.equal(fs.statSync(path.join(dest, 'a.json')).mode & 0o777, 0o600);
  assert.equal(fs.readlinkSync(path.join(dest, 'l.json')), '/nowhere');
  assert.throws(() => tool.backup(dir, dest), (e) => e.code === 'EEXIST', 'a second backup overwrote the first');
});

test('#5418: applying removes tokens through revoke and re-checks each other entry before unlinking it', (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'x.json.kosmos-1-t0-1-1.tmp'), 'tmp');
  fs.mkdirSync(path.join(dir, 'changed.tmp'));   // planned as a temp, now a folder: must not be removed
  const revoked = [];
  const plan = { remove: [
    { name: 'fix.json', kind: 'token', key: 'fix' },
    { name: 'x.json.kosmos-1-t0-1-1.tmp', kind: 'temp' },
    { name: 'changed.tmp', kind: 'temp' },
  ] };
  const res = tool.applyPlan(dir, plan, (key) => { revoked.push(key); return { ok: true }; });
  assert.deepEqual(revoked, ['fix']);
  assert.deepEqual(res.removed.sort(), ['fix.json', 'x.json.kosmos-1-t0-1-1.tmp']);
  assert.deepEqual(res.failed.map((f) => f.name), ['changed.tmp']);
  assert.equal(fs.existsSync(path.join(dir, 'changed.tmp')), true);
});

test('#5418: the port and the cutoff are required, never assumed', () => {
  assert.throws(() => tool.parseArgs(['--cutoff', '2026-10-08']), /--port is required/);
  assert.throws(() => tool.parseArgs(['--port', '1234']), /--cutoff is required/);
  assert.throws(() => tool.parseArgs(['--port', '1234', '--cutoff', 'soon']), /--cutoff is required/);
  const a = tool.parseArgs(['--port', '1234', '--cutoff', '2026-10-08T00:00:00Z', '--apply']);
  assert.equal(a.apply, true);
  assert.equal(a.cutoffMs, CUTOFF);
});

/* A stub board answering GET /api/status with `body`. */
async function stubBoard(t, status, body) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/status') { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => srv.close());
  return srv.address().port;
}

test('#5418: no roster means nothing is planned or removed', async (t) => {
  for (const [status, body] of [[500, {}], [200, { ok: true }]]) {
    const port = await stubBoard(t, status, body);
    await assert.rejects(tool.fetchRosterNames(port, null));
  }
});

test('#5418 end to end, in this test process\'s throwaway store: a dry run changes nothing; --apply backs up, then removes only the old orphan', async (t) => {
  const store = require('./engine/store');
  const sendertoken = require('./engine/sendertoken');
  assert.equal(store.realish(store.ROOT, process.platform).startsWith(store.realish(store.realDefaultRoot(process.platform), process.platform)), false,
    'this test must not run against the real store');
  const dir = sendertoken.DIR;
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, mtime) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify({ tokens: [{ token: 'x', instance: 'i' }] })); fs.utimesSync(p, mtime / 1000, mtime / 1000); };
  write('alice.json', OLD);
  write('fixture-e2e.json', OLD);
  t.after(() => { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true, recursive: true }); });
  const port = await stubBoard(t, 200, { agents: [{ name: 'alice' }] });
  const before = fs.readdirSync(dir).sort();
  const log = t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  assert.equal(await require('./tools/cleanup-fixture-tokens-5418').main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()]), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'a dry run changed the store');
  assert.equal(await require('./tools/cleanup-fixture-tokens-5418').main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply']), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['alice.json'], 'the live agent was removed, or the orphan was kept');
  const backups = fs.readdirSync(path.dirname(dir)).filter((n) => n.startsWith('sendertokens.backup-5418-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(path.dirname(dir), backups[0])).sort(), before, 'the backup is not a full copy');
  assert.ok(log.mock.calls.length > 0);
});

test('#5418: a board that lists NO agents stops the tool before anything is planned or removed', async (t) => {
  const sendertoken = require('./engine/sendertoken');
  const dir = sendertoken.DIR;
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'would-be-orphan.json');
  fs.writeFileSync(p, '{"tokens":[]}');
  fs.utimesSync(p, OLD / 1000, OLD / 1000);
  t.after(() => fs.rmSync(p, { force: true }));
  const port = await stubBoard(t, 200, { agents: [] });
  t.mock.method(console, 'log', () => {});
  const err = t.mock.method(console, 'error', () => {});
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply']), 2);
  assert.equal(fs.existsSync(p), true, 'an empty roster let a file be removed');
  assert.match(String(err.mock.calls[0].arguments[0]), /lists no agents/);
});
