'use strict';
/**
 * #7206: the vendor account routes (DeepSeek first) --
 *   POST   /api/accounts/compat        (add a key; the address is the vendor's, never the request's)
 *   DELETE /api/accounts/compat        (forget, or with remove:true delete)
 *   POST   /api/accounts/compat/check  (live check with the vendor)
 *   GET    /api/accounts               (carries the vendor rows, under the vendor, never as Claude)
 * The runner resolver is mocked (never the machine's claude) and the live check runs through setFetcher (never a real
 * vendor), the harness server.qwen-accounts-5977 uses.
 *
 *   node --test server.compat-accounts-7206.test.js
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-compat-routes-7206-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-compat-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-compat-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-compat-launch-');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const compat = require('./engine/anthropiccompat');
const runners = require('./engine/runners');
const { start, server } = require('./server');

const _origResolveBin = runners.resolveBin;
/* Shaped like the real resolveBin: Claude Code is filed under 'claude' (engine/runners.js); every other name answers
   present:false, so a route asking under another name (as 'anthropic') is caught. */
let claudeHere = true;
runners.resolveBin = (p) => (p === 'claude' && claudeHere
  ? { present: true, bin: '/mock/claude', managed: false, overridden: false }
  : { bin: null, present: false, managed: false, overridden: false });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  runners.resolveBin = _origResolveBin;
  compat.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  for (const d of [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
test.afterEach(() => { compat.setFetcher(null); compat.resetLiveCacheForTest(); });

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const del = (p, obj) => fetch(base + p, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const KEY = 'sk-deepseek-route-0123456789';
function vendorAnswers(reply) {
  const urls = [];
  compat.setFetcher(async (url) => { urls.push(url); if (reply === 'throw') throw new Error('ECONNREFUSED'); return reply; });
  return urls;
}
const hasModels = { status: 200, body: { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] } };

test('add: with no Claude Code on the computer, nothing is stored and the person is told why', async () => {
  vendorAnswers(hasModels);
  claudeHere = false;
  try {
    const r = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'noclaude' });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.needsRunner, true);
    assert.equal(b.provider, 'claude');
    assert.match(b.error, /could not find Claude Code, the runner DeepSeek agents use/);
    assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.kosmos-deepseek-noclaude')), false);
  } finally { claudeHere = true; }
});

test('add: a key DeepSeek refuses stores nothing, and the key went to DeepSeek only', async () => {
  const urls = vendorAnswers({ status: 401, body: null });
  const r = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'refused' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /DeepSeek did not accept this key/);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.kosmos-deepseek-refused')), false, 'a refused key left a folder');
  assert.deepEqual(urls, ['https://api.deepseek.com/models']);
});

test('add: a good key is stored, listed under DeepSeek in /api/accounts, never as a Claude account', async () => {
  const urls = vendorAnswers(hasModels);
  const r = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'work', baseUrl: 'https://elsewhere.example' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.provider, 'deepseek');
  assert.equal(b.account.model, 'deepseek-chat');
  assert.equal(b.connection.state, compat.STATE.CONNECTED);
  // The request's address is ignored: the stored account names the vendor, whose address is the table's.
  assert.equal(JSON.stringify(compat.readAccount(nodePath.join(SANDBOX, '.kosmos-deepseek-work'))).includes('elsewhere'), false);
  assert.equal(urls.every((u) => u === 'https://api.deepseek.com/models'), true);
  vendorAnswers(hasModels);
  const list = await (await fetch(base + '/api/accounts')).json();
  const rows = list.accounts.filter((a) => a.dir === nodePath.join(SANDBOX, '.kosmos-deepseek-work'));
  assert.equal(rows.length, 1, 'the account is not listed exactly once');
  assert.equal(rows[0].provider, 'deepseek');
  assert.equal(rows[0].providerName, 'DeepSeek');
  assert.equal(JSON.stringify(list).includes(KEY), false, 'the list carries the key');
});

test('add: a vendor that cannot be reached stores the account and says so; a second add of the name is refused', async () => {
  vendorAnswers('throw');
  const r = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'offline' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).connection.state, compat.STATE.UNKNOWN);
  vendorAnswers(hasModels);
  const again = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'offline' });
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already a DeepSeek account called offline/);
});

test('add: an empty folder left by an add that died is reclaimed after a minute; a fresh one is still taken', async () => {
  vendorAnswers(hasModels);
  const old = nodePath.join(SANDBOX, '.kosmos-deepseek-leftover');
  fs.mkdirSync(old, { mode: 0o700 });
  const past = (Date.now() - 5 * 60 * 1000) / 1000;
  fs.utimesSync(old, past, past);
  const r = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'leftover' });
  assert.equal(r.status, 200, 'an abandoned claim kept the name taken: ' + (await r.clone().text()));
  // Review 2: the leftover is renamed aside (atomic, one winner), and nothing it leaves is listed as an account.
  assert.equal(fs.readdirSync(SANDBOX).filter((n) => n.includes('leftover') && n !== '.kosmos-deepseek-leftover' && !n.startsWith('.removed-kosmos-deepseek-')).length, 0);
  assert.equal(compat.list().filter((a) => a.label.includes('leftover')).length, 1);
  const fresh = nodePath.join(SANDBOX, '.kosmos-deepseek-racing');
  fs.mkdirSync(fresh, { mode: 0o700 });
  const r2 = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'racing' });
  assert.equal(r2.status, 409, 'a claim under a minute old (another add in flight) was taken over');
});

test('add: an unknown vendor, a missing key, or a model the vendor lacks is refused before anything is asked', async () => {
  const urls = vendorAnswers(hasModels);
  for (const [body, want] of [
    [{ vendor: 'anthropic', key: KEY }, /does not know that provider/],
    [{ vendor: 'constructor', key: KEY }, /does not know that provider/],   // review 2: an inherited name
    [{ vendor: 'deepseek', key: '' }, /no DeepSeek key/],
    [{ vendor: 'deepseek', key: KEY, model: 'claude-sonnet-5' }, /DeepSeek has no model called claude-sonnet-5/],
  ]) {
    const r = await post('/api/accounts/compat', { ...body, label: 'bad' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, want);
  }
  assert.deepEqual(urls, [], 'the vendor was asked about a request that was already refused');
});

test('check: asks the vendor for a listed account; an unknown folder is 404', async () => {
  vendorAnswers(hasModels);
  await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'checked' });
  compat.resetLiveCacheForTest();
  vendorAnswers({ status: 401, body: null });
  const r = await post('/api/accounts/compat/check', { dir: nodePath.join(SANDBOX, '.kosmos-deepseek-checked') });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).state, compat.STATE.NONE);
  // A real Claude folder (it exists, with a sign-in file) is not a vendor account, so the check refuses it.
  const claudeDir = nodePath.join(SANDBOX, '.claude-work');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(nodePath.join(claudeDir, '.claude.json'), '{}');
  const missing = await post('/api/accounts/compat/check', { dir: claudeDir });
  assert.equal(missing.status, 404);
});

test('delete: forget sets the folder aside, remove deletes it; a Claude folder is never touched', async () => {
  vendorAnswers(hasModels);
  await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'gone' });
  await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'kept' });
  const dirGone = nodePath.join(SANDBOX, '.kosmos-deepseek-gone');
  const dirKept = nodePath.join(SANDBOX, '.kosmos-deepseek-kept');
  let r = await del('/api/accounts/compat', { dir: dirGone, remove: true });
  assert.equal(r.status, 200, await r.text());
  assert.equal(fs.existsSync(dirGone), false);
  r = await del('/api/accounts/compat', { dir: dirKept });
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(dirKept), false);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.removed-kosmos-deepseek-kept')), true, 'forget did not set it aside');
  const claudeDir = nodePath.join(SANDBOX, '.claude-other');
  fs.mkdirSync(claudeDir, { recursive: true });
  r = await del('/api/accounts/compat', { dir: claudeDir, remove: true });
  assert.notEqual(r.status, 200);
  assert.equal(fs.existsSync(claudeDir), true, 'a Claude folder was deleted through the vendor route');
});
