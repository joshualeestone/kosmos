'use strict';
/**
 * #7206 slice 1b, the weakest premise of Splinter's call (2026-10-26 14:28): that the default-off switch hides EVERY
 * route a person (or an agent acting for one) could reach DeepSeek by. With the switch OFF each route below must
 * refuse or show nothing, and no key may leave this computer; with it ON (the control) the same routes answer, so a
 * gate that refused everything could not pass.
 *
 *   status    GET  /api/accounts/compat            the page's question: is DeepSeek offered at all
 *   add       POST /api/accounts/compat            adding a DeepSeek key
 *   list      GET  /api/accounts                   a DeepSeek folder already on disk is not shown or checked
 *   create    POST /api/agents (provider)          a new agent on DeepSeek (the page's create form, and agents)
 *   switch    POST /api/agent/<name>/provider      moving an agent onto DeepSeek
 *   the page  every provider menu's DeepSeek row, and compatAsk
 *
 *   node --test server.compat-hidden-7206.test.js
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-compat-hidden-7206-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-compat-hidden-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-compat-hidden-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-compat-hidden-launch-');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const compat = require('./engine/anthropiccompat');
const runners = require('./engine/runners');
const { start, server } = require('./server');
const _origResolveBin = runners.resolveBin;
runners.resolveBin = (p) => (p === 'claude'
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

const KEY = 'sk-deepseek-hidden-0123456789';
const DIR = nodePath.join(SANDBOX, '.kosmos-deepseek-already');
compat.storeAccount(DIR, { vendor: 'deepseek', model: 'deepseek-chat', key: KEY });   // a folder already on disk
const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const NOT_YET = 'DeepSeek is not available in Kosmos yet';
function vendorAsked() {
  const urls = [];
  compat.setFetcher(async (url) => { urls.push(url); return { status: 200, body: { data: [{ id: 'deepseek-chat' }] } }; });
  return urls;
}
function withSwitch(on) { require('./test-support/compat-switch').setAt(SANDBOX, on); }   // the marker in this test's data folder
const bodyText = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } };

async function everyRoute() {
  compat.resetLiveCacheForTest();
  const asked = vendorAsked();
  const status = await (await fetch(base + '/api/accounts/compat')).json();
  const add = await post('/api/accounts/compat', { vendor: 'deepseek', key: KEY, label: 'route-add' });
  const addBody = await bodyText(add);
  const list = await (await fetch(base + '/api/accounts')).json();
  const create = await post('/api/agents', { name: 'ds-hidden', role: 'pm', provider: 'deepseek', account: DIR });
  const createBody = await bodyText(create);
  const sw = await post('/api/agent/ds-hidden-switch/provider', { provider: 'deepseek', account: DIR });
  const swBody = await bodyText(sw);
  compat.resetLiveCacheForTest();
  const check = await post('/api/accounts/compat/check', { dir: DIR });   // 1b review 1: a stored key's own check
  const checkBody = await bodyText(check);
  return { asked, status, add, addBody, list, create, createBody, sw, swBody, check, checkBody };
}
const says = (b) => JSON.stringify(b);

test('switch OFF: every route refuses or shows nothing, and no key is sent to DeepSeek', async () => {
  withSwitch(false);
  const r = await everyRoute();
  assert.deepEqual(r.status, { enabled: false, vendors: [] }, 'the page is offered DeepSeek');
  assert.equal(r.add.status, 400);
  assert.equal(r.addBody.error, NOT_YET, 'add: ' + says(r.addBody));
  assert.equal(r.list.accounts.some((a) => a.provider === 'deepseek' || a.dir === DIR), false, 'list: a DeepSeek row is shown');
  assert.ok(r.create.status >= 400, 'create: ' + r.create.status + ' ' + says(r.createBody));
  assert.ok(says(r.createBody).includes(NOT_YET), 'create did not refuse in the switch\'s words: ' + says(r.createBody));
  assert.ok(r.sw.status >= 400, 'switch: ' + r.sw.status + ' ' + says(r.swBody));
  assert.ok(says(r.swBody).includes(NOT_YET), 'switch did not refuse in the switch\'s words: ' + says(r.swBody));
  assert.equal(r.check.status, 400, 'check: ' + says(r.checkBody));
  assert.equal(r.checkBody.error, NOT_YET);
  assert.deepEqual(r.asked, [], 'a key was sent to DeepSeek while the switch is off');
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.kosmos-deepseek-route-add')), false, 'add stored an account');
});

test('CONTROL, switch ON: the same routes answer (so the OFF test is not a gate that refuses everything)', async () => {
  withSwitch(true);
  try {
    const r = await everyRoute();
    assert.equal(r.status.enabled, true);
    assert.equal(r.add.status, 200, says(r.addBody));
    assert.equal(r.list.accounts.some((a) => a.dir === DIR && a.provider === 'deepseek'), true, 'list: the existing account is not shown');
    assert.equal(says(r.createBody).includes(NOT_YET), false, 'create still refuses as off: ' + says(r.createBody));
    assert.equal(says(r.swBody).includes(NOT_YET), false, 'switch still refuses as off: ' + says(r.swBody));
    assert.equal(r.check.status, 200, 'check: ' + says(r.checkBody));
  } finally { withSwitch(false); }
});

test('the page: every provider menu lists DeepSeek as a disabled "coming soon" row, and compatAsk keeps it so while off', async () => {
  const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const rows = [...PAGE.matchAll(/<option value="deepseek"([^>]*)>([^<]*)<\/option>/g)];
  assert.equal(rows.length, 3, 'expected the DeepSeek row in Add a provider, the create menu and the switch menu');
  for (const [, attrs, text] of rows) {
    assert.match(attrs, /\bdisabled\b/, 'a DeepSeek row is enabled in the markup');
    assert.match(text, /coming soon/);
  }
  // compatAsk, run against a board that says OFF, then ON (the control), on a stand-in document.
  const script = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
  const at = script.indexOf('const COMPAT_ASK_MS');
  assert.ok(at > -1 && script.indexOf('function compatAsk(', at) > at, 'compatAsk (and its cache) moved in the page');
  const src = script.slice(at, script.indexOf('\n}\n', script.indexOf('function compatAsk(', at)) + 2);
  const opts = [1, 2, 3].map(() => ({ disabled: true, textContent: 'DeepSeek · coming soon', value: 'deepseek' }));
  const pick = opts[0];
  const doc = { querySelectorAll: () => opts, querySelector: (q) => (q.includes('acct-provider-pick') ? pick : null) };
  const run = async (enabled, startOn = false) => {
    let shown = null;
    // eslint-disable-next-line no-new-func
    const fn = new Function('document', 'fetch', 'onWindows', 'acctCompatShow', 'let COMPAT_ON = ' + (startOn ? 'true' : 'false') + ';\n' + src + '\nreturn async () => { const r = await compatAsk(); return [r, COMPAT_ON]; };')(
      doc, async () => { if (enabled === 'fail') throw new Error('network'); return { ok: true, json: async () => ({ enabled, vendors: enabled ? [{ id: 'deepseek' }] : [] }) }; },
      () => false, (on) => { shown = on; });
    const out = await fn();
    return [...out, shown];
  };
  const [offAnswer] = await run(false);
  assert.equal(offAnswer, false);
  for (const o of opts) { assert.equal(o.disabled, true); assert.match(o.textContent, /coming soon/); }
  const [onAnswer] = await run(true);
  assert.equal(onAnswer, true, 'CONTROL: compatAsk never turns it on');
  assert.equal(pick.disabled, false, 'CONTROL: Add a provider is not offered when the switch is on');
  assert.equal(pick.textContent, 'DeepSeek');
  // 1b review 1: a failed ask keeps what was known and never puts the form away (it would clear a pasted key).
  const [failKept, , failShown] = await run('fail', true);
  assert.equal(failKept, true, 'one failed ask turned DeepSeek off');
  assert.equal(failShown, null, 'one failed ask put the form (and a pasted key) away');
  const [, , offShown] = await run(false, true);
  assert.equal(offShown, false, 'CONTROL: a definite off from the board does put it away');
});
