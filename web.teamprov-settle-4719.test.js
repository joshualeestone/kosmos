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
    world({ stepHidden: true, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: { started: false } }),
    world({ stepHidden: false, options: [], selected: '', tc: { started: false } }),
    world({ stepHidden: false, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: null }),
  ]) {
    w.ctx.settle();
    assert.equal(w.fills(), 0);
  }
});

test('#4719 a started team keeps its choice: settling does not touch it', () => {
  const w = world({ stepHidden: false, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: { started: true } });
  w.ctx.settle();
  assert.equal(w.fills(), 0);
  assert.equal(w.sel.value, 'meta');
});

test('#4719 CONTROL: an open team step with an unusable choice goes back to the default, once', () => {
  const w = world({ stepHidden: false, options: [['anthropic', false], ['meta', true]], selected: 'meta', tc: { started: false } });
  w.ctx.settle();
  assert.equal(w.sel.value, 'anthropic');
  assert.equal(w.fills(), 1);
  w.ctx.settle();   // now usable: nothing more
  assert.equal(w.fills(), 1);
});
