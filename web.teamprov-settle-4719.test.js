'use strict';
/**
 * kosmos#4719: the team step's Model menu settles an unusable choice back to the default, and does
 * NOTHING when there is no team step to settle. The Muse answer calls tcProviderSettle on every
 * create-form paint; in review round 4 an empty, unopened team menu read as "unusable", refilled
 * (which asks Muse again), and the answer settled again: a /api/muse read loop on every board with
 * Muse on. Lifted from the shipped page and run against a fake document.
 *
 *   node --test web.teamprov-settle-4719.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function world({ stepHidden, options, selected, tc }) {
  const opts = options.map(([value, disabled]) => ({ value, disabled }));
  const sel = {
    options: opts,
    get selectedIndex() { return opts.findIndex((o) => o.value === this.value); },
    value: selected,
  };
  const els = { 'tc-provider': sel, 'cstep-teammake': { hidden: stepHidden } };
  let fills = 0;
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    CREATE_ACCOUNTS: [{ provider: 'anthropic' }],
    acctProvider: (a) => a.provider,
    fillCreateAccounts: () => { fills += 1; },
    TC_PICKER: {},
    tcChoiceFixed: () => Boolean(tc && tc.fixed),   // the page's one rule, stubbed: its own test is below
  };
  const start = SCRIPT.indexOf('function tcProviderDefault');
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function tcProviderSettle')) + 3;
  assert.ok(start > 0 && end > start, 'tcProviderDefault / tcProviderSettle moved');
  vm.runInNewContext('let TC = null;\n' + SCRIPT.slice(start, end)
    + '\nthis.setTC = (t) => { TC = t; }; this.settle = tcProviderSettle;', ctx);
  ctx.setTC(tc);
  return { ctx, sel, fills: () => fills };
}

test('#4719 no open team step: settling does nothing (no refill, so no Muse read loop)', () => {
  for (const w of [
    world({ stepHidden: true, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: { fixed: false } }),
    world({ stepHidden: false, options: [], selected: '', tc: { fixed: false } }),
    world({ stepHidden: false, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: null }),
  ]) {
    w.ctx.settle();
    assert.equal(w.fills(), 0);
  }
});

test('#4719 a fixed choice is kept: settling does not touch it', () => {
  const w = world({ stepHidden: false, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: { fixed: true } });
  w.ctx.settle();
  assert.equal(w.fills(), 0);
  assert.equal(w.sel.value, 'meta');
});

test('#4719 CONTROL: an open team step with an unusable choice goes back to the default, once', () => {
  const w = world({ stepHidden: false, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: { fixed: false } });
  w.ctx.settle();
  assert.equal(w.sel.value, 'anthropic');
  assert.equal(w.fills(), 1);
  w.ctx.settle();   // now usable: nothing more
  assert.equal(w.fills(), 1);
});

test('#4719 a default that is not usable either is not a correction: no refill', () => {
  const w = world({ stepHidden: false, options: [['anthropic', true], ['meta', true]], selected: 'meta', tc: { fixed: false } });
  w.ctx.settle();
  assert.equal(w.fills(), 0, 'it refilled (and asked Muse) toward a default it cannot use');
  assert.equal(w.sel.value, 'meta');
});

/* The ONE rule for when the team's provider and account are fixed (review round 7: the lock, the
   remembered choice and the settle each had its own condition, and they disagreed between run paths). */
test('#4719 the choice is fixed during a click or a run, and once any member exists or may exist', () => {
  const start = SCRIPT.indexOf('function tcMemberExists');
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function tcChoiceFixed')) + 3;
  assert.ok(start > 0 && end > start, 'tcMemberExists / tcChoiceFixed moved');
  const ctx = {};
  vm.runInNewContext('let TC = null;\n' + SCRIPT.slice(start, end) + '\nthis.fixed = (t) => { TC = t; return tcChoiceFixed(); };', ctx);
  const rows = (...ms) => ms.map((m) => ({ state: 'waiting', made: null, maybeMade: null, ...m }));
  assert.equal(ctx.fixed(null), false);
  assert.equal(ctx.fixed({ members: rows({}, {}) }), false, 'before the first press');
  assert.equal(ctx.fixed({ started: true, members: rows({ state: 'failed' }, {}) }), false, 'started, the lead refused, nothing made: still open');
  assert.equal(ctx.fixed({ busy: true, members: rows({}) }), true, 'during the click');
  assert.equal(ctx.fixed({ running: true, members: rows({}) }), true, 'during a Try again run');
  assert.equal(ctx.fixed({ members: rows({ made: { name: 'a' } }) }), true, 'a member exists');
  assert.equal(ctx.fixed({ members: rows({ maybeMade: 'a' }) }), true, 'a member may exist (its answer was lost)');
});

/* Review round 8: a settle or a late account list can change a menu without anyone "choosing", so the
   remembered choice must never be trusted before a member exists. */
test('#4719 the remembered choice is used only once a member exists; before that the menus are read', () => {
  const start = SCRIPT.indexOf('function tcMemberExists');
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function tcModel')) + 3;
  assert.ok(start > 0 && end > start, 'tcModel moved');
  const menus = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '/acct/claude' } };
  const ctx = { document: { getElementById: (id) => menus[id] || null } };
  vm.runInNewContext('let TC = null;\n' + SCRIPT.slice(start, end) + '\nthis.model = (t) => { TC = t; return tcModel(); };', ctx);
  const stale = { provider: 'meta' };
  const waiting = { state: 'waiting', made: null, maybeMade: null };
  // Started, the lead refused, the settle moved the menu to Claude: a Try again run (running) reads the menus.
  assert.deepEqual({ ...ctx.model({ started: true, running: true, model: stale, members: [{ ...waiting, state: 'failed' }, waiting] }) },
    { provider: 'anthropic', account: '/acct/claude' }, 'a stale remembered choice was used with nothing made');
  // CONTROL: once a member exists, the remembered choice is the team's, whatever the menus say.
  assert.deepEqual({ ...ctx.model({ started: true, model: stale, members: [{ ...waiting, made: { name: 'a' } }, waiting] }) }, stale);
  // And what is read is remembered for the members made from here on.
  const t = { members: [waiting] };
  ctx.model(t);
  assert.deepEqual({ ...t.model }, { provider: 'anthropic', account: '/acct/claude' });
});

/* A late account list (rounds 9 and 10): kept while the choice is fixed, applied when it is open, and a
   person who already chose keeps their provider and, when still offered, their account. */
function lateWorld({ fixed, touched, provider, start, account, offered }) {
  const acct = { value: account, options: [] };
  const sel = { value: provider };
  const els = { 'tc-provider': sel, 'tc-account': acct };
  let fills = 0;
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    tcChoiceFixed: () => fixed,
    tcProviderDefault: () => 'openai',
    tcProviderSettle: () => {},
    TC_PICKER: {},
    // Like the real fill: the account menu is rebuilt from the list, back on its first entry.
    fillCreateAccounts: () => { fills += 1; acct.options = offered.map((value) => ({ value })); acct.value = offered[0] || ''; },
  };
  const at = SCRIPT.indexOf('function tcApplyLateAccounts');
  const end = SCRIPT.indexOf('\n}\n', at) + 3;
  assert.ok(at > 0 && end > at, 'tcApplyLateAccounts moved');
  vm.runInNewContext(`let TC = { lateAccounts: true }; let TC_PROVIDER_TOUCHED = ${touched}; let TC_PROVIDER_START = ${JSON.stringify(start)};\n`
    + SCRIPT.slice(at, end) + '\nthis.apply = tcApplyLateAccounts; this.pending = () => TC.lateAccounts;', ctx);
  return { ctx, sel, acct, fills: () => fills };
}

test('#4719 a late account list waits while the choice is fixed, and is applied once it is open', () => {
  const held = lateWorld({ fixed: true, touched: false, provider: 'anthropic', start: 'anthropic', account: '', offered: ['/a/1'] });
  held.ctx.apply();
  assert.equal(held.fills(), 0);
  assert.equal(held.ctx.pending(), true, 'a list that landed during a run was dropped');
  const open = lateWorld({ fixed: false, touched: false, provider: 'anthropic', start: 'anthropic', account: '', offered: ['/a/1'] });
  open.ctx.apply();
  assert.deepEqual([open.sel.value, open.acct.value, open.fills(), open.ctx.pending()], ['openai', '/a/1', 1, false]);
});

test('#4719 a late account list never moves a choice copied from the form or made by the person', () => {
  // Copied from the form (the start marker is not the menu's value): refilled, provider kept.
  const copied = lateWorld({ fixed: false, touched: false, provider: 'google', start: '\u0000', account: '', offered: ['/g/1'] });
  copied.ctx.apply();
  assert.deepEqual([copied.sel.value, copied.fills()], ['google', 1]);
  // Chosen by the person: provider kept, and their account when the list still offers it.
  const kept = lateWorld({ fixed: false, touched: true, provider: 'anthropic', start: 'anthropic', account: '/a/2', offered: ['/a/1', '/a/2'] });
  kept.ctx.apply();
  assert.deepEqual([kept.sel.value, kept.acct.value, kept.fills()], ['anthropic', '/a/2', 1]);
  // Their account is gone from the list: the list's own default stands.
  const gone = lateWorld({ fixed: false, touched: true, provider: 'anthropic', start: 'anthropic', account: '/a/9', offered: ['/a/1', '/a/2'] });
  gone.ctx.apply();
  assert.equal(gone.acct.value, '/a/1');
});

/* Review of the rebase onto #4557: the step id the settle reads must be the step that holds the menu in the real
   page, or the guard returns early on every call and nothing settles (the stub above cannot see that). */
test('#4719: tcProviderSettle reads the step that actually contains #tc-provider', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const fn = SCRIPT.slice(SCRIPT.indexOf('function tcProviderSettle'), SCRIPT.indexOf('function tcApplyLateAccounts'));
  const m = /const step = document\.getElementById\('([\w-]+)'\)/.exec(fn);
  assert.ok(m, 'tcProviderSettle no longer reads its step by id; re-anchor');
  const open = html.indexOf('<div id="' + m[1] + '"');
  assert.ok(open > 0, 'no element ' + m[1] + ' in the page');
  const nextStep = html.indexOf('<div id="cstep-', open + 1);
  const menu = html.indexOf('id="tc-provider"');
  assert.ok(menu > open && (nextStep < 0 || menu < nextStep), m[1] + ' does not contain #tc-provider');
  // CONTROL: the chooser screen does not contain the menu, so the same check would refuse the old id.
  const chooser = html.indexOf('<div id="cstep-team"');
  const afterChooser = html.indexOf('<div id="cstep-', chooser + 1);
  assert.ok(!(menu > chooser && menu < afterChooser), 'control: cstep-team unexpectedly contains #tc-provider');
});

test('#4719: tcPaint keeps the team menus disabled while tcFillProvider is still filling them', () => {
  const paint = SCRIPT.slice(SCRIPT.indexOf('function tcPaint('), SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function tcPaint(')));
  assert.match(paint, /e\.disabled = tcChoiceFixed\(\) \|\| TC_FILLING > 0;/);
  assert.match(SCRIPT, /TC_FILLING \+= 1;\s*try \{ await tcFillProviderNow\(gen\); \} finally \{ TC_FILLING -= 1; \}/);
});
