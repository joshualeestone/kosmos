'use strict';
/**
 * kosmos#4935: Create a Team sends ONE model for every member (Josh: "default all of them to a single model").
 * tcModel reads #tc-model beside the provider and account, sends it only when it has a value (an empty value is
 * "the vendor picks" or "not chosen yet", and create then uses its default), and once a member exists keeps the
 * model it was made on. tcSyncModel repaints the list only when the provider or account changed, so a person's
 * pick survives the 2 s repaints. Lifted from the shipped page and run against a fake document.
 *
 *   node --test web.teammodel-4935.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function lift(name) {
  const start = SCRIPT.indexOf('function ' + name + '(');
  const end = SCRIPT.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, name + ' moved');
  return SCRIPT.slice(start, end);
}

function modelWorld(els, tc) {
  const ctx = { document: { getElementById: (id) => els[id] || null } };
  vm.runInNewContext('let TC = null;\nfunction tcMemberExists() { return Boolean(TC && TC.made); }\n' + lift('tcModel')
    + '\nthis.model = (t) => { TC = t; return tcModel(); };', ctx);
  return (t) => JSON.parse(JSON.stringify(ctx.model(t === undefined ? tc : t)));   // out of the vm realm
}

test('#4935 the chosen model rides with the provider and account', () => {
  const m = modelWorld({ 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '/acct/c' }, 'tc-model': { value: 'opus' } });
  assert.deepEqual(m({}), { provider: 'anthropic', account: '/acct/c', model: 'opus' });
});

test('#4935 an empty model (the vendor picks, or not chosen) sends no model key', () => {
  const m = modelWorld({ 'tc-provider': { value: 'google' }, 'tc-account': { value: '' }, 'tc-model': { value: '' } });
  assert.deepEqual(m({}), { provider: 'google' });
  // CONTROL: the same world with a value does carry it, so the absence above is the empty value's doing.
  const c = modelWorld({ 'tc-provider': { value: 'google' }, 'tc-account': { value: '' }, 'tc-model': { value: 'x' } });
  assert.deepEqual(c({}), { provider: 'google', model: 'x' });
});

test('#4935 once a member exists, the model it was made on is kept even if the menu changed', () => {
  const els = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '' }, 'tc-model': { value: 'opus' } };
  const m = modelWorld(els);
  const tc = {};
  assert.deepEqual(m(tc), { provider: 'anthropic', model: 'opus' });
  tc.made = true;
  els['tc-model'].value = 'haiku';
  assert.deepEqual(m(tc), { provider: 'anthropic', model: 'opus' });
});

test('#4935 tcSyncModel repaints only on a provider or account change, and never once the choice is fixed', () => {
  const sel = { value: 'opus', disabled: false, dataset: {} };
  const els = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '/a' }, 'tc-model': sel, 'cstep-teammake': { hidden: false } };
  const painted = [];
  let fixed = false;
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    tcChoiceFixed: () => fixed, TC_FILLING: 0, TC: {},
    tcPaintModel: (pv, ac) => { painted.push(pv + '|' + ac); },
  };
  vm.runInNewContext('let TC_MODEL_FOR = null;\n' + lift('tcSyncModel') + '\nthis.sync = tcSyncModel;', ctx);
  ctx.sync(); ctx.sync(); ctx.sync();
  assert.deepEqual(painted, ['anthropic|/a'], 'the 2 s repaints must not rebuild the list');
  els['tc-account'].value = '/b'; ctx.sync();
  assert.deepEqual(painted, ['anthropic|/a', 'anthropic|/b']);
  assert.equal(sel.disabled, false);
  fixed = true; els['tc-provider'].value = 'openai'; ctx.sync();
  assert.equal(painted.length, 2, 'a fixed choice is not repainted');
  assert.equal(sel.disabled, true, 'and the menu is locked with the provider and account (item 8)');
});

/* Review 1: the subscription and Muse answers call tcSyncModel from every screen. With no open team step it must
   do nothing, or the first one on a fresh page reads the roles from a screen that has nothing to do with teams. */
test('#4935 tcSyncModel does nothing without an open team step', () => {
  for (const [tc, hidden] of [[null, false], [{}, true]]) {
    const painted = [];
    const els = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '' }, 'tc-model': { value: '', dataset: {} }, 'cstep-teammake': { hidden } };
    const ctx = { document: { getElementById: (id) => els[id] || null }, tcChoiceFixed: () => false, TC_FILLING: 0, TC: tc,
      tcPaintModel: () => { painted.push(1); } };
    vm.runInNewContext('let TC_MODEL_FOR = null;\n' + lift('tcSyncModel') + '\nthis.sync = tcSyncModel;', ctx);
    ctx.sync();
    assert.equal(painted.length, 0, JSON.stringify({ tc, hidden }));
  }
});

/* Review 2: tcPaintModel's branches, each against a fake document. The OpenAI list comes from the account's own
   models (escaped), the vendors that pick their own model hide the row and send nothing, and while a list is loading
   the menu says so and holds Create down (dataset.loading), so a team is never made on a silent default. */
function paintWorld({ models = [], openai = null, rolesBody = null, waitMs = 0, stuck = false } = {}) {
  const sel = { value: '', disabled: false, dataset: {}, _html: '', options: [],
    set innerHTML(h) { this._html = h; this.options = [...h.matchAll(/<option value="([^"]*)"( selected)?/g)].map((m) => ({ value: m[1], sel: !!m[2] }));
      const pick = this.options.find((o) => o.sel) || this.options[0]; this.value = pick ? pick.value : ''; },
    get innerHTML() { return this._html; } };
  const row = { hidden: false };
  const why = { textContent: '', hidden: true };
  const go = { disabled: false };
  const retry = { disabled: false };
  const els = { 'tc-model': sel, 'tc-model-row': row, 'tc-model-why': why, 'tc-go': go };
  const fetched = [];
  let paints = 0;
  const ctx = {
    document: { getElementById: (id) => els[id] || null, querySelectorAll: (q) => (q === '#tc-list .tc-retry' ? [retry] : []) },
    CREATE_MODELS: models, TC: {}, TC_FILLING: 0, tcChoiceFixed: () => false, tcPaint: () => { paints += 1; },
    esc: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    vendorPicksModel: (p) => ['google', 'xai', 'antigravity', 'meta'].includes(p),
    switchKeyedWord: (p) => ({ google: 'Gemini', xai: 'Grok' })[p] || p,
    openaiNoModelsNote: () => 'OpenAI picks its own model.',
    setTimeout,
    fetch: (url) => { fetched.push(url); if (stuck) return new Promise(() => {}); const body = /openai/.test(url) ? openai : rolesBody;
      return Promise.resolve({ ok: !!body, json: () => Promise.resolve(body) }); },
  };
  vm.runInNewContext('let TC_MODEL_GEN = 0;\nlet TC_MODEL_WAIT_MS = ' + (waitMs || 8000) + ';\n' + lift('tcPaintModel') + '\nthis.paint = tcPaintModel;', ctx);
  return { ctx, sel, row, why, go, retry, fetched, paints: () => paints };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('#4935 Claude: the engine\'s list on its default, ready to press', () => {
  const w = paintWorld({ models: [{ key: 'opus', label: 'Opus' }, { key: 'sonnet', label: 'Sonnet', default: true }] });
  w.ctx.paint('anthropic', '');
  assert.deepEqual(w.sel.options.map((o) => o.value), ['opus', 'sonnet']);
  assert.equal(w.sel.value, 'sonnet');
  assert.equal(w.sel.dataset.loading, '');
  assert.equal(w.row.hidden, false);
  assert.equal(w.go.disabled, false, 'a list already held does not touch Create');
});

test('#4935 a vendor that picks its own model: row hidden, no value, the reason said', () => {
  const w = paintWorld();
  w.ctx.paint('google', '');
  assert.equal(w.row.hidden, true);
  assert.equal(w.sel.value, '');
  assert.equal(w.why.hidden, false);
  assert.match(w.why.textContent, /Gemini picks its own model/);
  assert.equal(w.fetched.length, 0, 'nothing is read for a vendor that picks');
});

test('#4935 OpenAI: loading holds Create, then the account\'s models (escaped) after "Let OpenAI choose"', async () => {
  const w = paintWorld({ openai: { ok: true, models: [{ key: 'gpt-5', label: 'GPT-5' }, { key: 'x"><b', label: '<i>odd</i>' }] } });
  w.ctx.paint('openai', '/acct/o');
  assert.equal(w.sel.dataset.loading, '1', 'loading must hold Create down');
  assert.equal(w.sel.disabled, true);
  assert.equal(w.go.disabled, true, 'Create is held the moment the load starts, not on the next repaint');
  assert.equal(w.retry.disabled, true, 'and so is Try again');
  await tick(); await tick(); await tick();
  assert.equal(w.sel.dataset.loading, '');
  assert.equal(w.sel.options.length, 3, w.sel.innerHTML);
  assert.equal(w.sel.options[1].value, 'gpt-5');
  assert.equal(w.sel.options[0].value, '', 'Let OpenAI choose is first and sends no model');
  assert.ok(!/<i>|"><b/.test(w.sel.innerHTML), 'a model name reached the menu unescaped');
  assert.ok(w.fetched[0].includes('dir=%2Facct%2Fo'), w.fetched[0]);
  assert.equal(w.paints(), 1, 'Create is offered again once the list lands');
});

test('#4935 OpenAI account that cannot list models: one fixed line, no value', async () => {
  const w = paintWorld({ openai: { ok: false } });
  w.ctx.paint('openai', '/acct/o');
  await tick(); await tick(); await tick();
  assert.equal(w.sel.value, '');
  assert.equal(w.sel.dataset.fixed, '1');
  assert.equal(w.sel.dataset.loading, '');
  assert.match(w.sel.innerHTML, /OpenAI picks its own model for now/);
});

test('#4935 roles not read yet: loading holds Create, then the plain /api/roles list (never the catalogue)', async () => {
  const w = paintWorld({ rolesBody: { models: [{ key: 'sonnet', label: 'Sonnet', default: true }] } });
  w.ctx.paint('anthropic', '');
  assert.equal(w.sel.dataset.loading, '1');
  assert.equal(w.go.disabled, true);
  await tick(); await tick(); await tick();
  assert.equal(w.fetched[0], '/api/roles', 'the catalogue read (?catalogue=1) is the role picker\'s alone');
  assert.equal(w.sel.value, 'sonnet');
  assert.equal(w.sel.dataset.loading, '');
  assert.equal(w.paints(), 1);
});

/* Review 6: a switch to a provider with nothing to load, while a list is loading, offers Create again at once (the
   stale answer is dropped by its generation, so nothing else would). */
test('#4935 switching provider mid-load releases Create and Try again', async () => {
  const w = paintWorld({ openai: { ok: true, models: [{ key: 'gpt-5', label: 'GPT-5' }] } });
  w.ctx.paint('openai', '/acct/o');
  assert.equal(w.go.disabled, true, 'premise: held while loading');
  w.ctx.paint('google', '');   // Gemini picks its own: nothing to load
  assert.equal(w.go.disabled, false, 'Create stayed held after the load was abandoned');
  assert.equal(w.retry.disabled, false);
  await tick(); await tick(); await tick();
  assert.equal(w.sel.dataset.loading, '', 'the abandoned OpenAI answer must not land');
});

/* Review 6: a failed roles read is not retried in a loop: it waits until the list is held by another path. */
test('#4935 a failed roles read marks a retry and does not fetch again by itself', async () => {
  const w = paintWorld({ rolesBody: null });
  w.ctx.paint('anthropic', '');
  await tick(); await tick(); await tick();
  assert.equal(w.sel.dataset.retry, '1');
  assert.equal(w.fetched.length, 1, 'one read, not a loop');
  assert.equal(w.paints(), 1);
});

/* Review 7: the recovery branch. After a failed roles read, a sync with the list now held repaints the menu. */
test('#4935 after a failed roles read, the menu repaints once the list is held', () => {
  const sel = { value: '', disabled: true, dataset: { retry: '1', fixed: '1' } };
  const els = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '' }, 'tc-model': sel, 'cstep-teammake': { hidden: false } };
  const painted = [];
  const ctx = { document: { getElementById: (id) => els[id] || null }, tcChoiceFixed: () => false, TC_FILLING: 0, TC: {}, CREATE_MODELS: [],
    tcPaintModel: (pv, ac) => { painted.push(pv + '|' + ac); } };
  vm.runInNewContext('let TC_MODEL_FOR = "anthropic|";\n' + lift('tcSyncModel') + '\nthis.sync = tcSyncModel;', ctx);
  ctx.sync();
  assert.equal(painted.length, 0, 'no list yet: no repaint (no loop)');
  ctx.CREATE_MODELS = [{ key: 'sonnet', label: 'Sonnet', default: true }];
  ctx.sync();
  assert.deepEqual(painted, ['anthropic|'], 'the held list did not repaint the failed menu');
});

test('#4935 a provider the menu has no list for sends no model (never a Claude key)', () => {
  const w = paintWorld({ models: [{ key: 'sonnet', label: 'Sonnet', default: true }] });
  w.ctx.paint('mistral', '');
  assert.equal(w.sel.value, '');
  assert.ok(!/sonnet/.test(w.sel.innerHTML));
});

/* Review 8: while the provider menus are filling they hold the last team's values; no list is painted for them. */
test('#4935 tcSyncModel paints nothing while the provider menus are filling', () => {
  const painted = [];
  const els = { 'tc-provider': { value: 'openai' }, 'tc-account': { value: '/old' }, 'tc-model': { value: '', dataset: {} }, 'cstep-teammake': { hidden: false } };
  const ctx = { document: { getElementById: (id) => els[id] || null }, tcChoiceFixed: () => false, TC_FILLING: 1, TC: {}, CREATE_MODELS: [],
    tcPaintModel: () => { painted.push(1); } };
  vm.runInNewContext('let TC_MODEL_FOR = null;\n' + lift('tcSyncModel') + '\nthis.sync = tcSyncModel;', ctx);
  ctx.sync();
  assert.equal(painted.length, 0);
  ctx.TC_FILLING = 0;   // CONTROL: once filled, it paints
  ctx.sync();
  assert.equal(painted.length, 1);
});

/* Review 9: a stuck OpenAI models read does not hold Create down for ever: after the wait it reads as "cannot list". */
test('#4935 a stuck OpenAI models read gives up after the wait and releases Create', async () => {
  const w = paintWorld({ stuck: true, waitMs: 20 });
  w.ctx.paint('openai', '/acct/o');
  assert.equal(w.go.disabled, true, 'premise: held while loading');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(w.sel.dataset.loading, '', 'still loading after the wait');
  assert.match(w.sel.innerHTML, /OpenAI picks its own model for now/);
  assert.equal(w.go.disabled, false, 'Create still held after the wait');
});
