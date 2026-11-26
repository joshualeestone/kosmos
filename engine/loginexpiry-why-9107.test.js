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
  for (const l of lines) assert.ok(!l.includes(h) && !l.includes(elsewhere) && !l.includes(os.userInfo().username), 'no path or user name in: ' + l);
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
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(le.fileBodyNow(f, 1000 + 1), body({ refreshTokenExpiresAt: UNTIL }), 'the background read is the next answer');
  assert.ok(le.loginGeneration() > gen0, 'a new body asks the advisories to recompute');
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
    await new Promise((r) => setTimeout(r, 200));
    const at = Date.now();
    le.fileBodyNow(f, at + 10);
    assert.strictEqual(started, 1, 'a fresh body is not read again');
    le.fileBodyNow(f, at + le.FILE_REREAD_MS + 10);
    assert.strictEqual(started, 2, 'an old one is');
  } finally { fs.readFile = orig; }
});
