'use strict';
/**
 * #7206: accounts for providers whose endpoint speaks Claude Code's API (DeepSeek first). An account is
 * ~/.kosmos-<vendor>-<label> holding kosmos-endpoint.json (mode 600), never a Claude account. These pin what is
 * stored and refused, that the key is only ever sent to the vendor (never api.anthropic.com), the live check's
 * verdicts, and the launch environment the supervisor applies.
 *
 *   node --test engine/anthropiccompat-7206.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-compat-7206-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const compat = require('./anthropiccompat');

test.after(() => { compat.setFetcher(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const KEY = 'sk-deepseek-0123456789abcdef';
const GOOD = { vendor: 'deepseek', model: 'deepseek-chat', key: KEY };
let n = 0;
function account(ep) {
  const dir = nodePath.join(SANDBOX, compat.dirPrefix('deepseek') + 'a' + (++n));
  compat.storeAccount(dir, ep || GOOD);
  return dir;
}
function answering(reply) {
  const calls = [];
  compat.setFetcher(async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (reply === 'throw') throw new Error('ECONNREFUSED with a path /Users/someone in it');
    return reply;
  });
  return calls;
}
const models = (...ids) => ({ status: 200, body: { object: 'list', data: ids.map((id) => ({ id })) } });

test('the table: every vendor has an https address, an https check address and a default model', () => {
  for (const v of Object.values(compat.VENDORS)) {
    assert.match(v.baseUrl, /^https:\/\//, v.id);
    assert.match(v.checkUrl, /^https:\/\//, v.id);
    assert.ok(v.models.length > 0, v.id);
    // The key goes to the vendor only: no row points at Anthropic.
    assert.doesNotMatch(v.baseUrl + v.checkUrl, /anthropic\.com/, v.id);
  }
  assert.equal(compat.VENDORS.deepseek.baseUrl, 'https://api.deepseek.com/anthropic');
});

test('a folder is a vendor account by its name; a Claude folder never is', () => {
  assert.equal(compat.vendorOfName(nodePath.join(SANDBOX, '.kosmos-deepseek-work')), 'deepseek');
  assert.equal(compat.isCompatHome(nodePath.join(SANDBOX, '.kosmos-deepseek-work')), true);
  for (const not of ['.claude', '.claude-work', '.kosmos-deepseek-', '.kosmos-qwen-local', '.removed-kosmos-deepseek-x', 'kosmos-deepseek-x']) {
    assert.equal(compat.isCompatHome(nodePath.join(SANDBOX, not)), false, not);
  }
  assert.equal(compat.isCompatHome(''), false);
  assert.equal(compat.isCompatHome(null), false);
});

test('accountProblem accepts a good account and refuses what cannot work, in words a person can act on', () => {
  assert.equal(compat.accountProblem(GOOD), null);
  assert.equal(compat.accountProblem({ ...GOOD, model: 'deepseek-reasoner' }), null);
  assert.match(compat.accountProblem({ ...GOOD, vendor: 'anthropic' }), /no provider Kosmos knows/);
  assert.match(compat.accountProblem({ ...GOOD, model: 'claude-sonnet-5' }), /DeepSeek has no model called claude-sonnet-5/);
  assert.match(compat.accountProblem({ ...GOOD, key: '' }), /no DeepSeek key/);
  assert.match(compat.accountProblem({ ...GOOD, key: 'sk with space' }), /does not look like a key/);
  assert.match(compat.accountProblem({ ...GOOD, key: 'sk\u0007bell' }), /does not look like a key/);
  assert.match(compat.accountProblem({ ...GOOD, key: 'k'.repeat(4097) }), /too long/);
  // Review 1: a character a header cannot carry (a curly apostrophe pasted from a web page) is refused, not stored.
  assert.match(compat.accountProblem({ ...GOOD, key: 'sk-abc\u2019def' }), /plain letters, digits and symbols/);
  assert.match(compat.accountProblem(null), /no provider/);
});

test('storeAccount writes mode 600 under a mode 700 folder, and reads back exactly what was stored', () => {
  const dir = account();
  assert.equal(fs.statSync(compat.endpointFile(dir)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(compat.readAccount(dir), { kind: 'ok', account: GOOD });
});

test('storeAccount refuses a bad account, a folder named for another vendor, and a symlinked folder', () => {
  assert.throws(() => compat.storeAccount(nodePath.join(SANDBOX, '.kosmos-deepseek-bad'), { ...GOOD, key: '' }), /no DeepSeek key/);
  assert.throws(() => compat.storeAccount(nodePath.join(SANDBOX, '.claude-sneaky'), GOOD), /named for its provider/);
  const real = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-compat-7206-real-'));
  const link = nodePath.join(SANDBOX, '.kosmos-deepseek-linked');
  fs.symlinkSync(real, link);
  assert.throws(() => compat.storeAccount(link, GOOD), /must not be a symlink/);
  assert.equal(fs.existsSync(nodePath.join(real, compat.ENDPOINT_BASENAME)), false, 'the key landed through the link');
});

/* The folder-versus-file vendor check in readAccount cannot be reached while the table has one vendor (any other
   vendor is refused first as unknown). It gets its test in slice 2, when GLM is the second row. */
test('readAccount keeps absent, unreadable and invalid apart (a hand-edited model the vendor lacks is invalid)', () => {
  const empty = nodePath.join(SANDBOX, '.kosmos-deepseek-empty');
  fs.mkdirSync(empty);
  assert.deepEqual(compat.readAccount(empty), { kind: 'absent' });
  const junk = nodePath.join(SANDBOX, '.kosmos-deepseek-junk');
  fs.mkdirSync(junk);
  fs.writeFileSync(compat.endpointFile(junk), '{not json');
  assert.deepEqual(compat.readAccount(junk), { kind: 'unreadable' });
  const hand = account();
  fs.writeFileSync(compat.endpointFile(hand), JSON.stringify({ ...GOOD, model: 'gpt-5' }));
  assert.equal(compat.readAccount(hand).kind, 'invalid');
});

test('list finds vendor accounts only: never a Claude folder, a symlink, or a file named like an account', () => {
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-compat-7206-list-'));
  const prev = process.env.AGENT_WORKFORCE_HOME;
  process.env.AGENT_WORKFORCE_HOME = home;
  try {
    compat.storeAccount(nodePath.join(home, '.kosmos-deepseek-work'), GOOD);
    fs.mkdirSync(nodePath.join(home, '.claude-work'));
    fs.writeFileSync(nodePath.join(home, '.claude-work', compat.ENDPOINT_BASENAME), JSON.stringify(GOOD));
    fs.writeFileSync(nodePath.join(home, '.kosmos-deepseek-file'), 'x');
    fs.symlinkSync(nodePath.join(home, '.kosmos-deepseek-work'), nodePath.join(home, '.kosmos-deepseek-link'));
    const rows = compat.list();
    assert.deepEqual(rows.map((r) => r.label), ['work']);
    assert.equal(rows[0].provider, 'deepseek');
    assert.equal(rows[0].providerName, 'DeepSeek');
    assert.equal(rows[0].authMode, 'key');
    assert.equal(rows[0].keyTail, 'cdef');
    assert.equal(JSON.stringify(rows).includes(KEY), false, 'a listed row carries the whole key');
    assert.deepEqual(compat.list('deepseek').map((r) => r.label), ['work']);
    assert.deepEqual(compat.list('glm'), []);
  } finally { process.env.AGENT_WORKFORCE_HOME = prev; fs.rmSync(home, { recursive: true, force: true }); }
});

test('the live check sends the key to the VENDOR only (never api.anthropic.com), as a Bearer key', async () => {
  compat.resetLiveCacheForTest();
  const calls = answering(models('deepseek-chat', 'deepseek-reasoner'));
  const r = await compat.checkLive(account());
  assert.equal(r.state, compat.STATE.CONNECTED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(calls[0].auth, 'Bearer ' + KEY);
  assert.doesNotMatch(calls.map((c) => c.url).join(' '), /anthropic\.com/);
});

test('the live verdicts: NONE only on the vendor\'s own answer, UNKNOWN for everything else', async () => {
  const verdict = async (reply, ep) => { compat.resetLiveCacheForTest(); answering(reply); return compat.checkLive(account(ep)); };
  assert.equal((await verdict({ status: 401, body: null })).state, compat.STATE.NONE);
  assert.match((await verdict({ status: 401, body: null })).because, /DeepSeek did not accept this key/);
  assert.equal((await verdict({ status: 403, body: null })).state, compat.STATE.NONE);
  const missing = await verdict(models('deepseek-chat'), { ...GOOD, model: 'deepseek-reasoner' });
  assert.equal(missing.state, compat.STATE.NONE);
  assert.match(missing.because, /does not offer deepseek-reasoner/);
  assert.equal((await verdict({ status: 500, body: null })).state, compat.STATE.UNKNOWN);
  assert.equal((await verdict({ status: 302, body: null })).state, compat.STATE.UNKNOWN, 'a redirect is not followed and not a NONE');
  assert.equal((await verdict({ status: 200, body: { nope: 1 } })).state, compat.STATE.UNKNOWN);
  const down = await verdict('throw');
  assert.equal(down.state, compat.STATE.UNKNOWN);
  assert.doesNotMatch(down.because, /ECONNREFUSED|\/Users\//, 'a raw error reached the person');
});

test('checkLive on a folder with no account, or a broken one, never asks the vendor', async () => {
  compat.resetLiveCacheForTest();
  const calls = answering(models('deepseek-chat'));
  const empty = nodePath.join(SANDBOX, '.kosmos-deepseek-none');
  fs.mkdirSync(empty);
  assert.equal((await compat.checkLive(empty)).state, compat.STATE.NONE);
  assert.equal(calls.length, 0);
});

test('launchEnv points Claude Code at the vendor with the key and the model, and refuses a broken account', () => {
  const r = compat.launchEnv(account({ ...GOOD, model: 'deepseek-reasoner' }));
  assert.equal(r.ok, true);
  assert.equal(r.model, 'deepseek-reasoner');
  assert.equal(r.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(r.env.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-reasoner');
  assert.equal(r.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1', 'Claude Code\'s own background requests would go to Anthropic');
  // Never ANTHROPIC_API_KEY: Claude Code would also try it against its own sign-in, and the supervisor unsets it.
  assert.equal('ANTHROPIC_API_KEY' in r.env, false);
  // Every variable the launch sets is one the supervisor unsets first.
  for (const k of Object.keys(r.env)) assert.ok(compat.LAUNCH_VARS.includes(k), k + ' is set but not in LAUNCH_VARS');
  const empty = nodePath.join(SANDBOX, '.kosmos-deepseek-nokey');
  fs.mkdirSync(empty);
  const no = compat.launchEnv(empty);
  assert.equal(no.ok, false);
  assert.equal(no.because, 'this DeepSeek account cannot be used: it has no key set up');
});

test('launchEnv refuses an account file that is a link', () => {
  const dir = nodePath.join(SANDBOX, '.kosmos-deepseek-filelink');
  fs.mkdirSync(dir);
  const elsewhere = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-compat-7206-el-')), 'ep.json');
  fs.writeFileSync(elsewhere, JSON.stringify(GOOD));
  fs.symlinkSync(elsewhere, compat.endpointFile(dir));
  const r = compat.launchEnv(dir);
  assert.equal(r.ok, false);
  assert.match(r.because, /is a link/);
});

test('the supervisor entry prints NUL-separated NAME=VALUE pairs, or the refusal with exit 2', () => {
  const script = nodePath.join(__dirname, 'anthropiccompat.js');
  const out = execFileSync(process.execPath, [script, 'launch-env', account()], { encoding: 'utf8', env: { ...process.env } });
  const pairs = out.split('\0').filter(Boolean);
  assert.ok(pairs.includes('ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic'));
  assert.ok(pairs.includes('ANTHROPIC_AUTH_TOKEN=' + KEY));
  assert.ok(out.endsWith('\0'));
  const empty = nodePath.join(SANDBOX, '.kosmos-deepseek-cli-none');
  fs.mkdirSync(empty);
  let rc = 0; let said = '';
  try { execFileSync(process.execPath, [script, 'launch-env', empty], { encoding: 'utf8' }); } catch (e) { rc = e.status; said = String(e.stdout); }
  assert.equal(rc, 2);
  assert.equal(said, 'this DeepSeek account cannot be used: it has no key set up');
});
