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
/* A data root of this file's own (#4796: a test that runs a stub board must never let the real board token reach it),
   set before anything reads the store. #5418 ask 1 would give a throwaway anyway; this says so in the file. */
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'tokclean-data-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const tool = require('./tools/cleanup-fixture-tokens-5418');
const { safeKey } = require('./engine/store');
/* test-support/fleet writes a worker instruction file for a display name, and refuses unless the workers folder is a
   sandbox. Set before it is required. */
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'tokclean-workers-'));
test.after(() => fs.rmSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true, force: true }));
const fleet = require('./test-support/fleet');
/* --apply needs live execution, which only the tool's command line turns on. This file opts in for its own process
   (whose store is a throwaway, #5418 ask 1) and puts the gate back afterwards; one arm checks the refusal. */
const liveExecution = require('./engine/live-execution');
liveExecution.allowLiveExecution();
test.after(() => liveExecution.resetForTests());

const DAY = 24 * 3600 * 1000;
const CUTOFF = Date.parse('2026-10-01T00:00:00Z');   // a fixed PAST date: the tool refuses a future cutoff
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
    { name: 'My.Agent.json', isSymlink: false, mtimeMs: OLD },         // not a name the store writes: keep
    { name: 'remote-a.json', isSymlink: false, mtimeMs: OLD, tokens: { launchers: ['remote'], newestMintMs: OLD } },  // offline remote agent: keep
    { name: 'recent-mint.json', isSymlink: false, mtimeMs: OLD, tokens: { launchers: [], newestMintMs: NEW } },        // minted after the cutoff: keep
    { name: 'notes.tmp', isSymlink: false, mtimeMs: OLD },              // not the writer's temp shape: keep
    { name: 'z.json.kosmos-3-1690000000000-2.tmp', isSymlink: false, mtimeMs: OLD },  // the pre-thread temp shape: remove
    { name: 'alice.json.dangling', isSymlink: true, targetExists: false, mtimeMs: OLD },  // dangling, not a store name: keep
  ];
  const plan = tool.planCleanup(entries, live, CUTOFF, safeKey);
  assert.deepEqual(plan.remove.map((r) => r.name).sort(), ['fixture-a.json', 'planted.json', 'x.json.kosmos-1-t0-1-1.tmp', 'z.json.kosmos-3-1690000000000-2.tmp']);
  assert.deepEqual(plan.keep.map((k) => k.name).sort(), ['My.Agent.json', 'alice.json', 'alice.json.dangling', 'dir.json', 'fixture-b.json', 'linked.json', 'notes.tmp', 'notes.txt', 'recent-mint.json', 'remote-a.json', 'y.json.kosmos-2-t0-1-1.tmp']);
  // a DANGLING link named for a live agent is left alone
  const live2 = tool.planCleanup([{ name: 'alice.json', isSymlink: true, targetExists: false, mtimeMs: OLD }], live, CUTOFF, safeKey);
  assert.deepEqual(live2.remove, []);
  assert.equal(plan.remove.length + plan.keep.length, entries.length, 'an entry was dropped from both lists');
  assert.equal(plan.remove.find((r) => r.name === 'fixture-a.json').key, 'fixture-a');
});

test('#5418: an unreadable or unknown-age file is never removed', () => {
  const plan = tool.planCleanup([{ name: 'odd.json', isSymlink: false, mtimeMs: null }], new Set(), CUTOFF, safeKey);
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
  assert.equal(tool.planCleanup(tool.listEntries(dir), new Set(), Date.now() + DAY, safeKey).keep.some((k) => k.name === 'd.json'), true);
});

test('#5418: the backup copies files with their modes and links as links, and never overwrites one', { skip: process.platform === 'win32' && 'POSIX modes and symlinks' }, (t) => {
  const root = scratch(t);
  const dir = path.join(root, 'tokens');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.json'), 'A', { mode: 0o600 });
  fs.symlinkSync('/nowhere', path.join(dir, 'l.json'));
  fs.writeFileSync(path.join(dir, 'live.json'), 'L', { mode: 0o600 });   // not being removed: must NOT be copied
  const dest = path.join(root, 'backup');
  tool.backup(dir, dest, ['a.json', 'l.json']);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['a.json', 'l.json'], 'the backup copied a live credential it was not removing');
  assert.equal(fs.readFileSync(path.join(dest, 'a.json'), 'utf8'), 'A');
  assert.equal(fs.statSync(path.join(dest, 'a.json')).mode & 0o777, 0o600);
  assert.equal(fs.readlinkSync(path.join(dest, 'l.json')), '/nowhere');
  assert.throws(() => tool.backup(dir, dest, ['a.json']), (e) => e.code === 'EEXIST', 'a second backup overwrote the first');
});


test('#5418: the port and the cutoff are required, never assumed', () => {
  assert.throws(() => tool.parseArgs(['--cutoff', '2026-10-08']), /--port is required/);
  assert.throws(() => tool.parseArgs(['--port', '1234']), /--cutoff is required/);
  assert.throws(() => tool.parseArgs(['--port', '70000', '--cutoff', '2026-10-01']), /--port is required/);
  assert.throws(() => tool.parseArgs(['--port', '1234', '--cutoff', 'soon']), /--cutoff is required/);
  assert.throws(() => tool.parseArgs(['--port', '1234', '--cutoff', '2026-10-01T00:00:00Z', '--apply']), /--confirm/);
  const a = tool.parseArgs(['--port', '1234', '--cutoff', '2026-10-01T00:00:00Z', '--apply', '--confirm', 'abc']);
  assert.equal(a.apply, true);
  assert.equal(a.cutoffMs, CUTOFF);
  assert.throws(() => tool.parseArgs(['--port', '1234', '--cutoff', new Date(Date.now() + DAY).toISOString()]), /in the future/);
  assert.throws(() => tool.parseArgs(['--port', '1234', '--cutoff', new Date(Date.now() - 60000).toISOString()]), /an hour in the past/);
});

/* A stub board answering GET /api/status with `body`. */
async function stubBoard(t, status, body, { kosmos = true, seen = [] } = {}) {
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, token: req.headers['x-kosmos-board-token'] || null });
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(kosmos ? '{"app":"kosmos","ok":true}' : '{"app":"something-else"}'); return; }
    if (req.url === '/api/status') { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => srv.close());
  // the tool requires --port to be this account's own board port; for the test, that is the stub's
  const prev = process.env.KOSMOS_PORT;
  process.env.KOSMOS_PORT = String(srv.address().port);
  t.after(() => { if (prev === undefined) delete process.env.KOSMOS_PORT; else process.env.KOSMOS_PORT = prev; });
  return srv.address().port;
}

/* What a person does: run the dry run, read its digest, then --apply --confirm it. */
async function digestOf(argv) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await tool.main(argv); } finally { console.log = orig; }
  const m = lines.map((l) => /Plan digest: (\w+)/.exec(l)).find(Boolean);
  return m ? m[1] : 'none';
}
async function applyConfirmed(port) {
  const argv = ['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()];
  return tool.main(argv.concat('--apply', '--confirm', await digestOf(argv)));
}

test('#5418: no roster means nothing is planned or removed', async (t) => {
  for (const [status, body] of [[500, {}], [200, { ok: true }]]) {
    const port = await stubBoard(t, status, body);
    await assert.rejects(tool.fetchRoster(port, null));
  }
});

/* The store this test process uses (its throwaway, per #5418 ask 1), with a board token so the tool's
   "no token, no run" guard passes, and every file removed afterwards. */
function e2eStore(t) {
  const store = require('./engine/store');
  const sendertoken = require('./engine/sendertoken');
  const boardauth = require('./engine/boardauth');
  assert.equal(store.realish(store.ROOT, process.platform).startsWith(store.realish(store.realDefaultRoot(process.platform), process.platform)), false,
    'this test must not run against the real store');
  boardauth.ensureToken();
  const dir = sendertoken.DIR;
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true, recursive: true });
    for (const f of fs.readdirSync(path.dirname(dir))) if (f.startsWith(tool.BACKUP_PREFIX)) fs.rmSync(path.join(path.dirname(dir), f), { force: true, recursive: true });
  });
  const write = (name, mtime) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify({ tokens: [{ token: 'x', instance: 'i' }] })); fs.utimesSync(p, mtime / 1000, mtime / 1000); };
  return { dir, write };
}
function quiet(t) { t.mock.method(console, 'log', () => {}); return t.mock.method(console, 'error', () => {}); }

test('#5418 end to end: a dry run changes nothing; --apply backs up, then removes only the old orphan, keeping every spelling of a live agent', async (t) => {
  const { dir, write } = e2eStore(t);
  write('claudebot.json', OLD);      // card reads "Splinter", session "claudebot": the TOKEN key is the session
  write('sam.json', OLD);            // a -discord twin: session "sam-discord", tokens under "sam"
  write('My.Agent.json', OLD);       // not a name the store writes: left alone
  write('fixture-e2e.json', OLD);    // the orphan
  // Real cards from the real producer (test-support/fleet): `claudebot` displays as "Splinter", and both panes run
  // in `<name>-discord` sessions, as on the fleet. A card's display name is NOT its token key.
  const f = fleet.install([fleet.agent('claudebot', { displayName: 'Splinter' }), fleet.agent('sam')]);
  t.after(() => f.restore());
  const cards = JSON.parse(JSON.stringify(f.agents));
  assert.ok(cards.some((c) => c.name === 'Splinter'), 'the fixture did not give claudebot its display name');
  const port = await stubBoard(t, 200, { agents: cards });
  const before = fs.readdirSync(dir).sort();
  quiet(t);
  const argv = ['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()];
  assert.equal(await tool.main(argv), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'a dry run changed the store');
  assert.equal(await tool.main(argv.concat('--apply', '--confirm', await digestOf(argv))), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['My.Agent.json', 'claudebot.json', 'sam.json'], 'a live agent was removed, or the orphan was kept');
  const backups = fs.readdirSync(path.dirname(dir)).filter((n) => n.startsWith(tool.BACKUP_PREFIX));
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(path.dirname(dir), backups[0])).sort(), ['fixture-e2e.json'], 'the backup is not exactly what was removed');
});

test('#5418: a roster that matches NONE of the store\'s token files (another store\'s board) stops the tool', async (t) => {
  const { dir, write } = e2eStore(t);
  write('alice.json', OLD);
  write('bob.json', OLD);
  const f = fleet.install([fleet.agent('zed')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'unread']), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['alice.json', 'bob.json']);
  assert.match(String(err.mock.calls[0].arguments[0]), /different store/);
});

test('#5418: every spelling of a roster row is kept: session, display, +world and -discord stripped', (t) => {
  // The shape comes from the real producer; only the session is varied, to reach the +world and -discord forms.
  const f = fleet.install([fleet.agent('claudebot', { displayName: 'Splinter' })]);
  t.after(() => f.restore());
  const card = JSON.parse(JSON.stringify(f.agents[0]));
  card.sessionName = 'claudebot-discord+qa';
  assert.deepEqual(tool.spellingsOf(card).sort(), ['Splinter', 'claudebot', 'claudebot-discord', 'claudebot-discord+qa'].sort());
});

test('#5418: a board that lists NO agents stops the tool before anything is planned or removed', async (t) => {
  const { dir, write } = e2eStore(t);
  write('would-be-orphan.json', OLD);
  const p = path.join(dir, 'would-be-orphan.json');
  const port = await stubBoard(t, 200, { agents: [] });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'unread']), 2);
  assert.equal(fs.existsSync(p), true, 'an empty roster let a file be removed');
  assert.match(String(err.mock.calls[0].arguments[0]), /lists no agents/);
});

test('#5418: no board token for this store stops the tool (nothing ties the board on that port to it)', async (t) => {
  const { dir, write } = e2eStore(t);
  write('would-be-orphan.json', OLD);
  const boardauth = require('./engine/boardauth');
  t.mock.method(boardauth, 'readToken', () => null);
  const f = fleet.install([fleet.agent('a')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'unread']), 2);
  assert.equal(fs.existsSync(path.join(dir, 'would-be-orphan.json')), true);
  assert.match(String(err.mock.calls[0].arguments[0]), /no board token/);
});

test('#5418: applying removes a token only if, under the lock, it is still the file planned; temps and links are re-checked', async (t) => {
  const { dir, write } = e2eStore(t);
  const sendertoken = require('./engine/sendertoken');
  write('fix.json', OLD);
  write('fresh.json', OLD);
  const planned = fs.lstatSync(path.join(dir, 'fresh.json')).mtimeMs;
  sendertoken.mint('fresh');                            // a launch mints AFTER the plan looked: rewrites fresh.json
  fs.writeFileSync(path.join(dir, 'x.json.kosmos-1-t0-1-1.tmp'), 'tmp');
  fs.mkdirSync(path.join(dir, 'changed.tmp'));          // planned as a temp, now a folder
  const plan = { remove: [
    { name: 'fix.json', kind: 'token', key: 'fix', mtimeMs: fs.lstatSync(path.join(dir, 'fix.json')).mtimeMs },
    { name: 'fresh.json', kind: 'token', key: 'fresh', mtimeMs: planned },
    { name: 'x.json.kosmos-1-t0-1-1.tmp', kind: 'temp' },
    { name: 'changed.tmp', kind: 'temp' },
  ] };
  const res = tool.applyPlan(dir, plan, sendertoken.revokeIfUnchanged);
  assert.deepEqual(res.removed.sort(), ['fix.json', 'x.json.kosmos-1-t0-1-1.tmp']);
  assert.deepEqual(res.failed.map((f) => f.name).sort(), ['changed.tmp', 'fresh.json']);
  assert.equal(fs.existsSync(path.join(dir, 'fresh.json')), true, 'a token minted after the plan was taken');
  assert.equal(fs.existsSync(path.join(dir, 'changed.tmp')), true);
});

test('#5418: tokenInfo reads the launchers and newest mint, and an unreadable file says nothing', (t) => {
  const dir = scratch(t);
  const a = path.join(dir, 'a.json');
  fs.writeFileSync(a, JSON.stringify({ tokens: [{ token: 'x', mintedAt: '2026-08-28T00:00:00Z', launcher: 'remote', name: 'Ada' }, { token: 'y', mintedAt: '2026-09-01T00:00:00Z' }] }));
  assert.deepEqual(tool.tokenInfo(a), { launchers: ['remote'], names: ['Ada'], newestMintMs: Date.parse('2026-09-01T00:00:00Z') });
  const b = path.join(dir, 'b.json');
  fs.writeFileSync(b, 'not json');
  assert.deepEqual(tool.tokenInfo(b), { launchers: [], names: [], newestMintMs: null });
});

test('#5418: a key in the removal records or with a heartbeat record of any age is kept, though not on the board', async (t) => {
  const { dir, write } = e2eStore(t);
  const store = require('./engine/store');
  const liveness = require('./engine/liveness');
  write('anchor.json', OLD);          // on the board, so the "matches none" backstop passes
  write('gone.json', OLD);            // removed agent: kept by the removal records
  write('remote-old.json', OLD);      // a remote agent minted before launcher tags, offline: kept by its heartbeat record
  write('fixture-x.json', OLD);       // the only orphan
  const removedFile = path.join(store.ROOT, 'removed.json');
  fs.writeFileSync(removedFile, JSON.stringify([{ name: 'gone', removedAt: new Date(OLD).toISOString() }]));
  liveness.seen('remote-old', new Date(OLD).toISOString());
  t.after(() => { fs.rmSync(removedFile, { force: true }); fs.rmSync(liveness.fileFor('remote-old'), { force: true }); });
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  quiet(t);
  assert.equal(await applyConfirmed(port), 0);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['anchor.json', 'gone.json', 'remote-old.json']);
});

test('#5418: a link swapped for a real file between plan and apply is not removed', { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' }, (t) => {
  const dir = scratch(t);
  fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, 'was-a-link.json'));
  fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, 'still-a-link.json'));
  const plan = tool.planCleanup(tool.listEntries(dir), new Set(), CUTOFF, safeKey);
  assert.deepEqual(plan.remove.map((r) => r.name).sort(), ['still-a-link.json', 'was-a-link.json']);
  fs.unlinkSync(path.join(dir, 'was-a-link.json'));
  fs.writeFileSync(path.join(dir, 'was-a-link.json'), 'now a real file');
  const res = tool.applyPlan(dir, plan, () => { throw new Error('no token is planned here'); });
  assert.deepEqual(res.removed, ['still-a-link.json']);
  assert.deepEqual(res.failed.map((x) => x.name), ['was-a-link.json']);
  assert.equal(fs.readFileSync(path.join(dir, 'was-a-link.json'), 'utf8'), 'now a real file');
});

test('#5418: nothing that does not answer as a Kosmos board is ever sent the board token', async (t) => {
  const seen = [];
  const port = await stubBoard(t, 200, { agents: [] }, { kosmos: false, seen });
  await assert.rejects(tool.fetchRoster(port, 'secret-board-token'), /Kosmos board/);
  assert.ok(seen.length >= 1, 'the health check never ran');
  assert.deepEqual(seen.filter((r) => r.token), [], 'the board token was sent to something that is not a Kosmos board');
});

test('#5418: the "different store" backstop counts the roster only: this store\'s own heartbeats cannot satisfy it', async (t) => {
  const { dir, write } = e2eStore(t);
  const liveness = require('./engine/liveness');
  write('alice.json', OLD);
  write('bob.json', OLD);
  liveness.seen('alice', new Date(OLD).toISOString());   // a heartbeat key that matches a token file
  t.after(() => fs.rmSync(liveness.fileFor('alice'), { force: true }));
  const f = fleet.install([fleet.agent('zed')]);        // a board whose roster matches NONE of this store's files
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'unread']), 2);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['alice.json', 'bob.json']);
  assert.match(String(err.mock.calls[0].arguments[0]), /different store/);
});

test('#5418: an agent the store keeps a profile for keeps its token though offline and not on the board', async (t) => {
  const { dir, write } = e2eStore(t);
  const store = require('./engine/store');
  write('anchor.json', OLD);
  write('adopted-x.json', OLD);
  write('fixture-y.json', OLD);
  store.writeProfile('adopted-x', { role: 'any profile at all' });
  t.after(() => { try { fs.rmSync(path.join(store.ROOT, store.PROFILES_DIRNAME), { recursive: true, force: true }); } catch { /* none */ } });
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  quiet(t);
  assert.equal(await applyConfirmed(port), 0);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['adopted-x.json', 'anchor.json']);
});

test('#5418: unreadable removal records stop the tool', async (t) => {
  const { dir, write } = e2eStore(t);
  const store = require('./engine/store');
  write('anchor.json', OLD);
  write('fixture-z.json', OLD);
  const removedFile = path.join(store.ROOT, 'removed.json');
  fs.writeFileSync(removedFile, 'not json');
  t.after(() => fs.rmSync(removedFile, { force: true }));
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'unread']), 2);
  assert.equal(fs.existsSync(path.join(dir, 'fixture-z.json')), true);
  assert.match(String(err.mock.calls[0].arguments[0]), /removal records/);
});

test('#5418: a backup that fails part way removes nothing and leaves no copy of a token behind', async (t) => {
  const { dir, write } = e2eStore(t);
  write('anchor.json', OLD);
  write('fixture-1.json', OLD);
  write('fixture-2.json', OLD);
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const realCopy = fs.copyFileSync;
  let n = 0;
  t.mock.method(fs, 'copyFileSync', (...a) => { n += 1; if (n === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return realCopy(...a); });
  quiet(t);
  assert.equal(await applyConfirmed(port), 3);
  assert.equal(n >= 2, true, 'the planted failure never fired');
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort(), ['anchor.json', 'fixture-1.json', 'fixture-2.json']);
  assert.deepEqual(fs.readdirSync(path.dirname(dir)).filter((x) => x.startsWith(tool.BACKUP_PREFIX)), [], 'a partial backup holding a token was left behind');
});

test('#5418: a backup folder that already exists is refused and never removed by the failure path', async (t) => {
  const { dir, write } = e2eStore(t);
  write('anchor.json', OLD);
  write('fixture-1.json', OLD);
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const realMkdir = fs.mkdirSync;
  let theirs = null;
  t.mock.method(fs, 'mkdirSync', (p, ...rest) => {
    if (String(p).includes(tool.BACKUP_PREFIX)) {           // somebody else's folder is already at that name
      theirs = p;
      realMkdir.call(fs, p, { recursive: true });
      fs.writeFileSync(path.join(p, 'theirs.json'), 'not ours');
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    }
    return realMkdir.call(fs, p, ...rest);
  });
  quiet(t);
  assert.equal(await applyConfirmed(port), 3);
  assert.ok(theirs, 'the planted folder never came into play');
  assert.equal(fs.readFileSync(path.join(theirs, 'theirs.json'), 'utf8'), 'not ours', 'a folder this run did not make was removed');
  assert.equal(fs.existsSync(path.join(dir, 'fixture-1.json')), true);
});

test('#5418: --apply removes only the plan the person confirmed: a roster that shrank since the dry run stops it', async (t) => {
  const { dir, write } = e2eStore(t);
  write('anchor.json', OLD);
  write('briefly-missing.json', OLD);   // listed by the board at the dry run, missing from a degraded roster at apply
  write('fixture-q.json', OLD);
  const full = fleet.install([fleet.agent('anchor'), fleet.agent('briefly-missing')]);
  const cardsFull = JSON.parse(JSON.stringify(full.agents));
  full.restore();
  const few = fleet.install([fleet.agent('anchor')]);
  const cardsFew = JSON.parse(JSON.stringify(few.agents));
  few.restore();
  let cards = cardsFull;
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url === '/api/health' ? '{"app":"kosmos","ok":true}' : JSON.stringify({ agents: cards }));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => srv.close());
  const port = srv.address().port;
  const prev = process.env.KOSMOS_PORT;
  process.env.KOSMOS_PORT = String(port);
  t.after(() => { if (prev === undefined) delete process.env.KOSMOS_PORT; else process.env.KOSMOS_PORT = prev; });
  const argv = ['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()];
  const err = quiet(t);
  const digest = await digestOf(argv);      // the person reads a plan that removes only fixture-q.json
  cards = cardsFew;                         // then the board answers without briefly-missing
  assert.equal(await tool.main(argv.concat('--apply', '--confirm', digest)), 4);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['anchor.json', 'briefly-missing.json', 'fixture-q.json']);
  assert.match(String(err.mock.calls.at(-1).arguments[0]), /not the one confirmed/);
});

test('#5418: a --port that is not this account\'s own board port is refused before the token goes anywhere', async (t) => {
  const seen = [];
  const port = await stubBoard(t, 200, { agents: [] }, { seen });
  process.env.KOSMOS_PORT = String(port + 1);   // this account's port is another one
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()]), 2);
  assert.deepEqual(seen, [], 'something was sent to the wrong port');
  assert.match(String(err.mock.calls[0].arguments[0]), /not this account's board port/);
});

test('#5418: --apply is refused without live execution (only the command line turns it on)', async (t) => {
  liveExecution.resetForTests();
  t.after(() => liveExecution.allowLiveExecution());
  const port = await stubBoard(t, 200, { agents: [] });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'x']), 2);
  assert.match(String(err.mock.calls[0].arguments[0]), /live execution/);
});

test('#5418: the derived port is KOSMOS_PORT when set and usable, nothing when it is set and unusable', () => {
  assert.equal(tool.expectedPort({ KOSMOS_PORT: '5555' }), 5555);
  assert.equal(tool.expectedPort({ KOSMOS_PORT: 'abc' }), null);
  assert.equal(tool.expectedPort({ KOSMOS_PORT: '70000' }), null);
  if (typeof process.getuid === 'function') {
    const uid = process.getuid();
    assert.equal(tool.expectedPort({}), uid === 501 ? 16180 : 16180 + 1 + (uid % 3999), 'not the derivation install/kosmos uses');
  }
});

test('#5418: an unusable KOSMOS_PORT stops the tool before anything is sent', async (t) => {
  const seen = [];
  const port = await stubBoard(t, 200, { agents: [] }, { seen });
  process.env.KOSMOS_PORT = 'not-a-port';
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()]), 2);
  assert.deepEqual(seen, []);
  assert.match(String(err.mock.calls[0].arguments[0]), /cannot be worked out/);
});

test('#5418: the digest changes with anything that drove a decision, not just names and times', () => {
  const base = { remove: [{ name: 'f.json', kind: 'token', key: 'f', mtimeMs: OLD, newestMintMs: OLD, launchers: [], names: ['f'] }] };
  const d = tool.planDigest(base);
  assert.notEqual(tool.planDigest({ remove: [{ ...base.remove[0], launchers: ['remote'] }] }), d);
  assert.notEqual(tool.planDigest({ remove: [{ ...base.remove[0], names: ['someone-else'] }] }), d);
  assert.notEqual(tool.planDigest({ remove: [{ ...base.remove[0], newestMintMs: OLD + 1 }] }), d);
  assert.equal(tool.planDigest({ remove: [{ ...base.remove[0] }] }), d, 'CONTROL: the same plan gives the same digest');
});

test('#5418: a token minted in the same mtime tick is kept (mintedAt is checked under the lock), and a file already gone is not counted as removed', async (t) => {
  const { dir, write } = e2eStore(t);
  const sendertoken = require('./engine/sendertoken');
  const p = path.join(dir, 'tick.json');
  fs.writeFileSync(p, JSON.stringify({ tokens: [{ token: 'a', instance: 'i', mintedAt: new Date(OLD).toISOString() }] }));
  fs.utimesSync(p, OLD / 1000, OLD / 1000);
  const planned = { mtimeMs: fs.lstatSync(p).mtimeMs, newestMintMs: OLD };
  // a coarse-mtime mount: a new token lands, and the mtime reads the same as before
  fs.writeFileSync(p, JSON.stringify({ tokens: [{ token: 'a', instance: 'i', mintedAt: new Date(OLD).toISOString() }, { token: 'b', instance: 'j', mintedAt: new Date().toISOString() }] }));
  fs.utimesSync(p, OLD / 1000, OLD / 1000);
  const res = tool.applyPlan(dir, { remove: [
    { name: 'tick.json', kind: 'token', key: 'tick', mtimeMs: planned.mtimeMs, newestMintMs: planned.newestMintMs },
    { name: 'never-there.json', kind: 'token', key: 'never-there', mtimeMs: OLD, newestMintMs: null },
  ] }, sendertoken.revokeIfUnchanged);
  assert.equal(fs.existsSync(p), true, 'a token minted in the same tick was taken');
  assert.deepEqual(res.failed.map((f) => f.name), ['tick.json']);
  assert.deepEqual(res.removed, [], 'a file that was already gone was counted as removed');
  assert.deepEqual(res.gone, ['never-there.json']);
});

test('#5418: a redirect on the call that carries the board token is refused, so the token goes nowhere else', async (t) => {
  const elsewhere = [];
  const sink = http.createServer((req, res) => { elsewhere.push(req.headers['x-kosmos-board-token'] || null); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"app":"kosmos","agents":[]}'); });
  await new Promise((ok) => sink.listen(0, '127.0.0.1', ok));
  t.after(() => sink.close());
  // the hop answers the health check as a board, then redirects the call that carries the token
  const hop = http.createServer((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"app":"kosmos","ok":true}'); return; }
    res.writeHead(302, { location: `http://127.0.0.1:${sink.address().port}${req.url}` }); res.end();
  });
  await new Promise((ok) => hop.listen(0, '127.0.0.1', ok));
  t.after(() => hop.close());
  await assert.rejects(tool.fetchRoster(hop.address().port, 'secret-board-token'));
  assert.deepEqual(elsewhere.filter(Boolean), [], 'the token followed a redirect');
});

test('#5418: a board that could not read all of its agents (unreadableLines) stops the tool', async (t) => {
  const { dir, write } = e2eStore(t);
  write('anchor.json', OLD);
  write('maybe-live.json', OLD);
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)), counts: { unreadableLines: 2 } });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()]), 2);
  assert.match(String(err.mock.calls[0].arguments[0]), /could not read all of its agents/);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['anchor.json', 'maybe-live.json']);
});

test('#5418: a non-OK board, or one with no agent list, stops main with nothing changed', async (t) => {
  const { dir, write } = e2eStore(t);
  write('x.json', OLD);
  for (const [status, body] of [[500, {}], [200, { ok: true }]]) {
    const port = await stubBoard(t, status, body);
    const err = quiet(t);
    assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString(), '--apply', '--confirm', 'x']), 2);
    assert.match(String(err.mock.calls.at(-1).arguments[0]), /could not read the board roster/);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')), ['x.json']);
  }
});

test('#5418: an unreadable heartbeat folder stops the tool; a profile that exists but cannot be read still keeps its token', async (t) => {
  const { dir, write } = e2eStore(t);
  const store = require('./engine/store');
  const liveness = require('./engine/liveness');
  write('anchor.json', OLD);
  write('corrupt-profile.json', OLD);
  write('fixture-c.json', OLD);
  fs.mkdirSync(path.join(store.ROOT, store.PROFILES_DIRNAME), { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, store.PROFILES_DIRNAME, store.profileFileName('corrupt-profile')), '{not json');
  t.after(() => fs.rmSync(path.join(store.ROOT, store.PROFILES_DIRNAME), { recursive: true, force: true }));
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  quiet(t);
  assert.equal(await applyConfirmed(port), 0);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['anchor.json', 'corrupt-profile.json']);
  // the heartbeat folder is there but is not a folder: not "none", so the tool stops
  fs.rmSync(liveness.DIR, { recursive: true, force: true });
  fs.writeFileSync(liveness.DIR, 'not a folder');
  t.after(() => fs.rmSync(liveness.DIR, { force: true }));
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()]), 2);
  assert.match(String(err.mock.calls.at(-1).arguments[0]), /heartbeat records could not be read/);
});

test('#5418: a profiles folder that cannot be listed stops the tool (the board\'s offline rows come from it)', async (t) => {
  const { dir, write } = e2eStore(t);
  const store = require('./engine/store');
  write('anchor.json', OLD);
  write('offline-x.json', OLD);
  const prof = path.join(store.ROOT, store.PROFILES_DIRNAME);
  fs.rmSync(prof, { recursive: true, force: true });
  fs.writeFileSync(prof, 'not a folder');
  t.after(() => fs.rmSync(prof, { force: true, recursive: true }));
  const f = fleet.install([fleet.agent('anchor')]);
  t.after(() => f.restore());
  const port = await stubBoard(t, 200, { agents: JSON.parse(JSON.stringify(f.agents)) });
  const err = quiet(t);
  assert.equal(await tool.main(['--port', String(port), '--cutoff', new Date(CUTOFF).toISOString()]), 2);
  assert.match(String(err.mock.calls.at(-1).arguments[0]), /profiles could not be read/);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['anchor.json', 'offline-x.json']);
});
