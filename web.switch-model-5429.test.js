'use strict';
/* kosmos#5429: the provider switch's model menu, from the page's real functions (fillSwitchModel, switchModelPicked).
   Claude: its models with the default preselected. OpenAI: the chosen account's list, "Let OpenAI choose" first.
   Gemini and the others: hidden (they pick their own). The current provider: hidden (nothing is being switched). */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function world({ provider, current = 'google', account = '', models = [], openai = null }) {
  const el = (id, extra = {}) => ({ id, hidden: true, disabled: false, value: '', innerHTML: '', selectedIndex: -1, options: [], dataset: {}, ...extra });
  const sel = el('d-provider-model');
  // innerHTML -> options, so value / selectedIndex behave as a select's would.
  let html = '';
  Object.defineProperty(sel, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = v;
      this.options = [...v.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], selected: !!m[2], textContent: m[3] }));
      const i = this.options.findIndex((o) => o.selected);
      this.selectedIndex = i === -1 ? (this.options.length ? 0 : -1) : i;
      this.value = this.selectedIndex === -1 ? '' : this.options[this.selectedIndex].value;
    },
  });
  const els = { 'd-provider-model': sel, 'd-provider': el('d-provider', { value: provider }), 'd-provider-account': el('d-provider-account', { hidden: !account, value: account }) };
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(url);
    if (url.startsWith('/api/accounts/openai/models')) {
      const answer = typeof openai === 'function' ? await openai(url) : openai;
      return { ok: true, json: async () => answer };
    }
    if (url === '/api/roles') return { ok: true, json: async () => ({ models }) };
    return { ok: false };
  };
  const ctx = { CURRENT: { sessionName: 'ada', provider: current }, CREATE_MODELS: [] };
  const src = page.liftAll(SCRIPT, ['fillSwitchModel', 'switchModelPicked']);
  const api = new Function('document', 'fetch', 'esc', 'providerOf', 'ctx',
    'let SWITCH_MODEL_GEN = 0; let CURRENT = ctx.CURRENT; let CREATE_MODELS = ctx.CREATE_MODELS;\n' + src + '\nreturn { fillSwitchModel, switchModelPicked };')(
    { getElementById: (id) => els[id] || null }, fetchFn, (s) => String(s), (a) => a.provider, ctx);
  return { api, sel, fetched, setAccount: (a) => Object.assign(els['d-provider-account'], a) };
}
const CLAUDE = [{ key: 'opus55', label: 'Claude Opus 5.5' }, { key: 'sonnet', label: 'Claude Sonnet 5', default: true }];

test('#5429: switching to Claude shows its models, the default preselected, and that is what is sent', async () => {
  const w = world({ provider: 'anthropic', models: CLAUDE });
  await w.api.fillSwitchModel();
  assert.equal(w.sel.hidden, false);
  assert.deepEqual(w.sel.options.map((o) => o.value), ['opus55', 'sonnet']);
  assert.equal(w.sel.value, 'sonnet', 'the create form\'s default');
  assert.deepEqual(w.api.switchModelPicked(), { key: 'sonnet', label: 'Claude Sonnet 5' });
});

test('#5429: switching to OpenAI shows the chosen account\'s models, Let OpenAI choose first (sent as nothing)', async () => {
  const w = world({ provider: 'openai', account: '/acct/a', openai: { ok: true, models: [{ key: 'gpt-6', label: 'GPT-6' }] } });
  await w.api.fillSwitchModel();
  assert.equal(w.sel.hidden, false);
  assert.ok(w.fetched.some((u) => u === '/api/accounts/openai/models?dir=' + encodeURIComponent('/acct/a')), 'the chosen account\'s list');
  assert.deepEqual(w.sel.options.map((o) => o.value), ['', 'gpt-6']);
  assert.equal(w.api.switchModelPicked(), null, 'Let OpenAI choose sends no model');
});

test('#5429: hidden for a provider that picks its own, for the current provider, and for an OpenAI account with no list', async () => {
  for (const p of ['google', 'xai', 'antigravity']) {
    const w = world({ provider: p, current: 'anthropic', models: CLAUDE });
    await w.api.fillSwitchModel();
    assert.equal(w.sel.hidden, true, p);
    assert.equal(w.api.switchModelPicked(), null, p);
  }
  const same = world({ provider: 'google', current: 'google', models: CLAUDE });
  await same.api.fillSwitchModel();
  assert.equal(same.sel.hidden, true, 'nothing is being switched');
  const unlisted = world({ provider: 'openai', account: '/acct/b', openai: { ok: false } });
  await unlisted.api.fillSwitchModel();
  assert.equal(unlisted.sel.hidden, true, 'OpenAI picks its own on that account');
  // CONTROL: the same world switching to Claude shows it, so the hides above are not a dead menu.
  const ctl = world({ provider: 'anthropic', current: 'google', models: CLAUDE });
  await ctl.api.fillSwitchModel();
  assert.equal(ctl.sel.hidden, false);
});

test('#5429: an OpenAI list that arrives after the switch moved on is dropped (generation guard)', async () => {
  // The first fill's answer (account A) arrives LATE, after a second fill (account B) has painted.
  let releaseA;
  const lateA = new Promise((r) => { releaseA = r; });
  const w = world({ provider: 'openai', account: '/acct/a', openai: async (url) => (url.includes(encodeURIComponent('/acct/a'))
    ? (await lateA, { ok: true, models: [{ key: 'gpt-a', label: 'GPT-A' }] })
    : { ok: true, models: [{ key: 'gpt-b', label: 'GPT-B' }] }) });
  const first = w.api.fillSwitchModel();
  w.sel.hidden = true;
  // The person picks account B.
  const acct = { hidden: false, value: '/acct/b' };
  const second = (async () => { w.setAccount(acct); await w.api.fillSwitchModel(); })();
  await second;
  releaseA();
  await first;
  assert.deepEqual(w.sel.options.map((o) => o.value), ['', 'gpt-b'], 'account A\'s late list did not overwrite account B\'s');
});
