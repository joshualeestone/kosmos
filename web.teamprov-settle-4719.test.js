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
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync('web/index.html', 'utf8'));

function world({ stepHidden, options, selected, tc }) {
  const opts = options.map(([value, disabled]) => ({ value, disabled }));
  const sel = {
    options: opts,
    get selectedIndex() { return opts.findIndex((o) => o.value === this.value); },
    value: selected,
  };
  const els = { 'tc-provider': sel, 'cstep-team': { hidden: stepHidden } };
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
