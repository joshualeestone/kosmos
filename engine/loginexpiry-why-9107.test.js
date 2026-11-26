'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9107: follow-ups to #9097's off-macOS login expiry reader.
 * Item 1: each refusal kind says once why no login warning shows, in words with no path.
 * Item 4: the board's synchronous read off macOS never waits on the file; it answers from a background read. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const le = require('./loginexpiry');

const TEMPS = [];
process.on('exit', () => { for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMPS.push(d); return d; };
const UNTIL = 1893456000000;
const body = (o) => JSON.stringify({ claudeAiOauth: o });
const DEF = le.serviceNameFor(undefined);

function homeWithLogin() {
  const h = tmp('le9107-');
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', '.credentials.json'), body({ refreshTokenExpiresAt: UNTIL }));
  return h;
}
// Counts the background reads still running, so a test can end only after its own have landed (review 1: a read left
// running would land in the next test and move the login generation there).
const realReadFile = fs.readFile;
const inflight = new Map();
const startedReads = new Map();   // every read ever started, per file (review 2: a control must be able to see one)
fs.readFile = function (p, ...rest) {
  const cb = rest.pop();
  inflight.set(p, (inflight.get(p) || 0) + 1);
  startedReads.set(p, (startedReads.get(p) || 0) + 1);
  return realReadFile.call(this, p, ...rest, (...a) => { inflight.set(p, inflight.get(p) - 1); cb(...a); });
};
process.on('exit', () => { fs.readFile = realReadFile; });
const pendingRead = (p) => (inflight.get(p) || 0) > 0;
// Waits for a background read by its effect, never by a fixed time (review 1: a loaded Windows runner is slow).
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
function capture() {
  const lines = [];
  le._resetForTests();
  le._setRefusalLogForTests((l) => lines.push(l));
  return lines;
}
test.afterEach(() => { le._resetForTests(); le._setRefusalLogForTests(() => {}); });

test('kosmos#9107 item 1: a folder outside the home says why, once, with no path in the words', () => {
  const lines = capture();
  const h = homeWithLogin();
  const elsewhere = tmp('le9107-out-');
  const read = () => le.readCredDefault('Claude Code-credentials-x', elsewhere, { platform: 'linux', home: h, readNow: () => 'X' });
  assert.strictEqual(read(), null);
  assert.strictEqual(read(), null);
  assert.deepStrictEqual(lines, ['loginexpiry: ' + le.REFUSAL_WORDS.outside], 'said once for two refusals');
  for (const l of lines) assert.ok(!l.includes(h) && !l.includes(elsewhere) && !l.includes(path.sep + 'Users') && !l.includes(path.sep + 'home'), 'no path in: ' + l);
  // CONTROL: a folder inside the home is read and says nothing.
  const inside = le.readCredDefault('Claude Code-credentials-x', path.join(h, '.claude'), { platform: 'linux', home: h, readNow: () => 'X' });
  assert.strictEqual(inside, 'X');
  assert.strictEqual(lines.length, 1);
});

test('kosmos#9107 item 1: a named account with no folder, and no home, each say their own line', () => {
  const lines = capture();
  assert.strictEqual(le.readCredDefault('Claude Code-credentials-2a1a4199', undefined, { platform: 'win32', home: tmp('le9107-a-'), readNow: () => 'X' }), null);
  assert.strictEqual(le.readCredDefault(DEF, undefined, { platform: 'win32', home: null, readNow: () => 'X' }), null);
  assert.deepStrictEqual(lines, ['loginexpiry: ' + le.REFUSAL_WORDS.account, 'loginexpiry: ' + le.REFUSAL_WORDS.nohome]);
});

test('kosmos#9107 item 1: a sandboxed board says so, outside a test run', () => {
  const lines = capture();
  const savedCtx = process.env.NODE_TEST_CONTEXT;
  const savedHome = process.env.AGENT_WORKFORCE_HOME;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    process.env.AGENT_WORKFORCE_HOME = tmp('le9107-sb-');
    const tried = [];
    assert.strictEqual(le.readCredDefault(DEF, undefined, { platform: 'linux', readNow: (f) => { tried.push(f); return 'X'; } }), null);
    assert.strictEqual(tried.length, 0, 'nothing is read');
    assert.deepStrictEqual(lines, ['loginexpiry: ' + le.REFUSAL_WORDS.sandbox]);
  } finally {
    if (savedCtx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = savedCtx;
    if (savedHome === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = savedHome;
  }
});

test('kosmos#9107 item 4: the first answer is null, the background read fills it, and a change starts a recompute', async () => {
  const h = homeWithLogin();
  const f = path.join(h, '.claude', '.credentials.json');
  le._resetForTests();
  const gen0 = le.loginGeneration();
  assert.strictEqual(le.fileBodyNow(f, 1000), null, 'the first answer does not wait for the file');
  await until(() => le.loginGeneration() > gen0);
  assert.strictEqual(le.fileBodyNow(f, 1000 + 1), body({ refreshTokenExpiresAt: UNTIL }), 'the background read is the next answer');
  // Through the reader the board calls: the same answer, from the same file.
  assert.ok(le.readCredDefault(DEF, undefined, { platform: 'linux', home: h, userHome: h }));
});

test('kosmos#9107 item 4: a read that never returns does not block, and starts no second read', () => {
  const h = homeWithLogin();
  const f = path.join(h, '.claude', '.credentials.json');
  le._resetForTests();
  const orig = fs.readFile;
  let started = 0;
  fs.readFile = function (p, ...rest) { if (p === f) { started += 1; return; } return orig.call(this, p, ...rest); };   // never calls back
  try {
    const t0 = Date.now();
    assert.strictEqual(le.fileBodyNow(f, 0), null);
    assert.strictEqual(le.fileBodyNow(f, le.FILE_REREAD_MS * 5), null);
    assert.ok(Date.now() - t0 < 1000, 'no wait');
    assert.strictEqual(started, 1, 'one read in flight, not one per call');
  } finally { fs.readFile = orig; }
});

test('kosmos#9107 item 4: within the re-read time no new read starts; after it, one does', async () => {
  const h = homeWithLogin();
  const f = path.join(h, '.claude', '.credentials.json');
  le._resetForTests();
  const orig = fs.readFile;
  let started = 0;
  fs.readFile = function (p, ...rest) { if (p === f) started += 1; return orig.call(this, p, ...rest); };
  try {
    le.fileBodyNow(f, 0);
    await until(() => le.fileBodyNow(f, 0) !== null);
    const at = Date.now();
    le.fileBodyNow(f, at + 10);
    assert.strictEqual(started, 1, 'a fresh body is not read again');
    le.fileBodyNow(f, at + le.FILE_REREAD_MS + 10);
    assert.strictEqual(started, 2, 'an old one is');
    await until(() => !pendingRead(f));   // no read left running past the test
    assert.strictEqual(started, 2);
  } finally { fs.readFile = orig; }
});

test('kosmos#9107 review 1: a sign-in starts a new read at once, so the old notice does not stay its 5 minutes (#5018)', async () => {
  const h = homeWithLogin();
  const f = path.join(h, '.claude', '.credentials.json');
  le._resetForTests();
  const g0 = le.loginGeneration();
  le.fileBodyNow(f, 0);
  await until(() => le.loginGeneration() > g0);
  const at = Date.now();
  // The sign-in writes a new date, then says so.
  fs.writeFileSync(f, body({ refreshTokenExpiresAt: UNTIL + 86400000 }));
  le.loginChanged();
  const g1 = le.loginGeneration();
  const before = startedReads.get(f) || 0;
  assert.strictEqual(le.fileBodyNow(f, at + 10), body({ refreshTokenExpiresAt: UNTIL }), 'the old body until the new read lands');
  assert.strictEqual(startedReads.get(f), before + 1, 'the sign-in started a read, inside the minute');
  await until(() => le.loginGeneration() > g1);
  assert.strictEqual(le.fileBodyNow(f, at + 20), body({ refreshTokenExpiresAt: UNTIL + 86400000 }), 'the new date, well inside the re-read minute');
  // CONTROL: with no sign-in, inside the minute, no read starts, and once any would have landed the body is unchanged.
  await until(() => !pendingRead(f));
  fs.writeFileSync(f, body({ refreshTokenExpiresAt: UNTIL + 2 * 86400000 }));
  const settled = startedReads.get(f);
  le.fileBodyNow(f, at + 30);
  assert.strictEqual(startedReads.get(f), settled, 'no read without a sign-in inside the minute');
  await until(() => !pendingRead(f));
  assert.strictEqual(le.fileBodyNow(f, at + 40), body({ refreshTokenExpiresAt: UNTIL + 86400000 }));
});

test('kosmos#9107 review 2: at most FILE_READS_MAX reads run at once, however many files stall', () => {
  le._resetForTests();
  const files = [0, 1, 2, 3].map(() => path.join(homeWithLogin(), '.claude', '.credentials.json'));
  const orig = fs.readFile;
  let started = 0;
  fs.readFile = function (p, ...rest) { if (files.includes(p)) { started += 1; return; } return orig.call(this, p, ...rest); };   // never call back
  try {
    for (const f of files) assert.strictEqual(le.fileBodyNow(f, 0), null);
    assert.strictEqual(started, le.FILE_READS_MAX, 'the rest wait for a free slot');
    assert.ok(le.FILE_READS_MAX < 4, 'fewer than libuv\'s default pool of 4');
  } finally { fs.readFile = orig; le._resetForTests(); }
});

test('kosmos#9107 review 2: a body caught mid-rewrite keeps the last good one and is read again next time', async () => {
  const h = homeWithLogin();
  const f = path.join(h, '.claude', '.credentials.json');
  le._resetForTests();
  le.fileBodyNow(f, 0);
  await until(() => !pendingRead(f) && le.fileBodyNow(f, 0) !== null);
  const good = body({ refreshTokenExpiresAt: UNTIL });
  const g = le.loginGeneration();
  fs.writeFileSync(f, '{"claudeAiOauth": {"refreshTok');   // half written
  const late = Date.now() + le.FILE_REREAD_MS + 10;
  le.fileBodyNow(f, late);
  await until(() => !pendingRead(f));
  assert.strictEqual(le.fileBodyNow(f, Date.now()), good, 'the last good body, not the torn one');
  assert.strictEqual(le.loginGeneration(), g, 'no recompute for a torn read');
  // The file is whole again: the next call reads it at once, not a minute later.
  await until(() => !pendingRead(f));
  fs.writeFileSync(f, body({ refreshTokenExpiresAt: UNTIL + 5 }));
  le.fileBodyNow(f, Date.now());
  await until(() => !pendingRead(f));
  assert.strictEqual(le.fileBodyNow(f, Date.now()), body({ refreshTokenExpiresAt: UNTIL + 5 }), 'read again at once after a torn read');
  // CONTROL: after a good read, the minute applies again: no read starts.
  await until(() => !pendingRead(f));
  const n = startedReads.get(f);
  le.fileBodyNow(f, Date.now());
  assert.strictEqual(startedReads.get(f), n);
});

test('kosmos#9107 review 1: an access-token refresh rewrites the file but does not move the login generation', async () => {
  const h = homeWithLogin();
  const f = path.join(h, '.claude', '.credentials.json');
  fs.writeFileSync(f, body({ refreshTokenExpiresAt: UNTIL, expiresAt: 1 }));
  le._resetForTests();
  le.fileBodyNow(f, 0);
  await until(() => le.fileBodyNow(f, 0) !== null);
  const g = le.loginGeneration();
  fs.writeFileSync(f, body({ refreshTokenExpiresAt: UNTIL, expiresAt: 2 }));   // what Claude Code does every few hours
  const late = Date.now() + le.FILE_REREAD_MS + 10;
  le.fileBodyNow(f, late);
  await until(() => !pendingRead(f));
  assert.strictEqual(le.fileBodyNow(f, Date.now()), body({ refreshTokenExpiresAt: UNTIL, expiresAt: 2 }), 'the new body is kept');
  assert.strictEqual(le.loginGeneration(), g, 'no recompute for a refresh that keeps the login date');
});
