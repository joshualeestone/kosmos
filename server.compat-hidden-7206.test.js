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
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');   // never the operator's own ~/.claude.json
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
  assert.equal(r.checkBody.error, NOT_YET);   // 2a review 5: the account's own vendor refuses, in its own name
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

test('the page: every provider menu lists DeepSeek, GLM and MiniMax as disabled "coming soon" rows, and compatAsk keeps each so while its own switch is off', async () => {
  const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  for (const [id, name] of [['deepseek', 'DeepSeek'], ['glm', 'Z.ai GLM'], ['minimax', 'MiniMax']]) {
    const rows = [...PAGE.matchAll(new RegExp('<option value="' + id + '"([^>]*)>([^<]*)</option>', 'g'))];
    assert.equal(rows.length, 3, 'expected the ' + name + ' row in Add a provider, the create menu and the switch menu');
    for (const [, attrs, text] of rows) {
      assert.match(attrs, /\bdisabled\b/, 'a ' + name + ' row is enabled in the markup');
      assert.match(text, /coming soon/);
    }
  }
  // compatAsk, run against a board that names some vendors on, on a stand-in document that answers by selector.
  const script = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
  const at = script.indexOf('const COMPAT_ASK_MS');
  assert.ok(at > -1 && script.indexOf('function compatAsk(', at) > at, 'compatAsk (and its cache) moved in the page');
  const src = script.slice(at, script.indexOf('\n}\n', script.indexOf('function compatAsk(', at)) + 2);
  const run = async (answer, opts = {}) => {
    const menus = {};
    for (const id of ['deepseek', 'glm', 'minimax']) menus[id] = [1, 2, 3].map(() => ({ disabled: true, textContent: id + ' · coming soon', value: id }));
    const doc = {
      querySelectorAll: (q) => { const m = /value="(\w+)"/.exec(q); return m && menus[m[1]] ? menus[m[1]] : []; },
      querySelector: (q) => { const m = /#acct-provider-pick option\[value="(\w+)"\]/.exec(q); return m && menus[m[1]] ? menus[m[1]][0] : null; },
    };
    let shown = null;
    // eslint-disable-next-line no-new-func
    const fn = new Function('document', 'fetch', 'onWindows', 'acctCompatShow', 'let COMPAT_ON = false;\n' + src
      + '\nreturn async (startOn, open) => { for (const id of startOn) COMPAT_ON_FOR[id] = true; COMPAT_ON = startOn.length > 0; ACCT_COMPAT_WHICH = open || "";'
      + ' const r = await compatAsk(); return [r, { ...COMPAT_ON_FOR }]; };')(
      doc, async () => {
        if (answer === 'fail') throw new Error('network');
        return { ok: true, json: async () => ({ enabled: answer.length > 0, vendors: answer.map((id) => ({ id })) }) };
      }, () => !!opts.windows, (on) => { shown = on; });
    const [any, onFor] = await fn(opts.startOn || [], opts.open);
    return { any, onFor, menus, shown };
  };
  const off = await run([]);
  assert.equal(off.any, false);
  for (const id of ['deepseek', 'glm', 'minimax']) for (const o of off.menus[id]) { assert.equal(o.disabled, true); assert.match(o.textContent, /coming soon/); }
  // CONTROL: DeepSeek's switch on offers DeepSeek, and only DeepSeek (one switch per vendor).
  const ds = await run(['deepseek']);
  assert.equal(ds.any, true, 'CONTROL: compatAsk never turns it on');
  assert.deepEqual(ds.onFor, { deepseek: true, glm: false, minimax: false });
  assert.equal(ds.menus.deepseek[0].disabled, false, 'CONTROL: Add a provider is not offered when the switch is on');
  assert.equal(ds.menus.deepseek[0].textContent, 'DeepSeek');
  assert.equal(ds.menus.glm[0].disabled, true, 'DeepSeek\'s switch offered GLM');
  assert.match(ds.menus.glm[0].textContent, /coming soon/);
  // 2b: GLM's own switch offers GLM, by its page name, and leaves DeepSeek coming soon.
  const glm = await run(['glm']);
  assert.deepEqual(glm.onFor, { deepseek: false, glm: true, minimax: false });
  assert.equal(glm.menus.glm[0].disabled, false, 'GLM is not offered under its own switch');
  assert.equal(glm.menus.glm[0].textContent, 'Z.ai GLM');
  assert.equal(glm.menus.deepseek[0].disabled, true, 'GLM\'s switch offered DeepSeek');
  // Windows: never offered, whatever the board says.
  const win = await run(['deepseek', 'glm', 'minimax'], { windows: true });
  assert.deepEqual(win.onFor, { deepseek: false, glm: false, minimax: false }, 'a vendor was offered on Windows');
  // slice 3: MiniMax by its own switch alone, by its page name.
  const mm = await run(['minimax']);
  assert.deepEqual(mm.onFor, { deepseek: false, glm: false, minimax: true });
  assert.equal(mm.menus.minimax[0].disabled, false, 'MiniMax is not offered under its own switch');
  assert.equal(mm.menus.minimax[0].textContent, 'MiniMax');
  assert.equal(mm.menus.glm[0].disabled, true, 'MiniMax\'s switch offered GLM');
  // 1b review 1: a failed ask keeps what was known and never puts the form away (it would clear a pasted key).
  const fail = await run('fail', { startOn: ['deepseek'], open: 'deepseek' });
  assert.equal(fail.any, true, 'one failed ask turned DeepSeek off');
  assert.equal(fail.shown, null, 'one failed ask put the form (and a pasted key) away');
  // CONTROL: a definite off for the open form's vendor does put it away.
  const gone = await run([], { startOn: ['deepseek'], open: 'deepseek' });
  assert.equal(gone.shown, false, 'CONTROL: a definite off from the board does put it away');
  // 2b: an off for ANOTHER vendor leaves the open form alone (turning DeepSeek off must not clear a pasted GLM key).
  const other = await run(['glm'], { startOn: ['deepseek', 'glm'], open: 'glm' });
  assert.equal(other.shown, null, 'DeepSeek going off put the open GLM form away');
});
