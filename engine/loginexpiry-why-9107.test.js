'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9107 item 1: off macOS, each kind of refusal says once why no login warning shows, in words with no path. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const le = require('./loginexpiry');

const TEMPS = [];
process.on('exit', () => { for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMPS.push(d); return d; };
const DEF = le.serviceNameFor(undefined);

function capture() {
  const lines = [];
  le._resetForTests();
  le._setRefusalLogForTests((l) => lines.push(l));
  return lines;
}
test.afterEach(() => { le._resetForTests(); le._setRefusalLogForTests(() => {}); });

test('kosmos#9107 item 1: a folder outside the home says why, once, with no path in the words', () => {
  const lines = capture();
  const h = tmp('le9107-');
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', '.credentials.json'), 'X');
  const elsewhere = tmp('le9107-out-');
  const read = () => le.readCredDefault('Claude Code-credentials-x', elsewhere, { platform: 'linux', home: h });
  assert.strictEqual(read(), null);
  assert.strictEqual(read(), null);
  assert.deepStrictEqual(lines, ['loginexpiry: ' + le.REFUSAL_WORDS.outside], 'said once for two refusals');
  for (const l of lines) assert.ok(!l.includes(h) && !l.includes(elsewhere) && !l.includes(path.sep + 'Users') && !l.includes(path.sep + 'home'), 'no path in: ' + l);
  // CONTROL: a folder inside the home is read and says nothing.
  assert.strictEqual(le.readCredDefault('Claude Code-credentials-x', path.join(h, '.claude'), { platform: 'linux', home: h }), 'X');
  assert.strictEqual(lines.length, 1);
});

test('kosmos#9107 item 1: a named account with no folder, and no home, each say their own line', () => {
  const lines = capture();
  assert.strictEqual(le.readCredDefault('Claude Code-credentials-2a1a4199', undefined, { platform: 'win32', home: tmp('le9107-a-') }), null);
  assert.strictEqual(le.readCredDefault(DEF, undefined, { platform: 'win32', home: null }), null);
  assert.deepStrictEqual(lines, ['loginexpiry: ' + le.REFUSAL_WORDS.account, 'loginexpiry: ' + le.REFUSAL_WORDS.nohome]);
});

test('kosmos#9107 item 1: a sandboxed board says so, outside a test run, and reads nothing', () => {
  const lines = capture();
  const savedCtx = process.env.NODE_TEST_CONTEXT;
  const savedHome = process.env.AGENT_WORKFORCE_HOME;
  const orig = fs.readFileSync;
  const tried = [];
  fs.readFileSync = function (f, ...rest) { if (String(f).endsWith('.credentials.json')) { tried.push(f); return 'X'; } return orig.call(this, f, ...rest); };
  try {
    delete process.env.NODE_TEST_CONTEXT;
    process.env.AGENT_WORKFORCE_HOME = tmp('le9107-sb-');
    assert.strictEqual(le.readCredDefault(DEF, undefined, { platform: 'linux' }), null);
    assert.strictEqual(tried.length, 0, 'nothing is read');
    assert.deepStrictEqual(lines, ['loginexpiry: ' + le.REFUSAL_WORDS.sandbox]);
  } finally {
    fs.readFileSync = orig;
    if (savedCtx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = savedCtx;
    if (savedHome === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = savedHome;
  }
});
