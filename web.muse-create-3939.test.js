'use strict';
/**
 * #3939 slice 3c-3b: Meta Muse in the Create Agent form. The Meta option is gated on GET /api/muse
 * (turned on here, installed, signed in), a read turned off here is not asked again, and a Meta pick
 * a read turns off goes back to the default with a sentence that names the real reason.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

function menu(id) {
  const opts = ['anthropic', 'openai', 'meta'].map((value) => ({ value, disabled: true, dataset: {} }));
  return { id, value: 'anthropic', options: opts, dataset: {}, opt: (v) => opts.find((o) => o.value === v) };
}

// eslint-disable-next-line no-new-func
const load = new Function('document', 'fetch', 'CURRENT', 'providerOf', 'createPickGone', `
  let CREATE_ACCOUNTS_KNOWN = true;
  let MUSE_CREATE = null; let MUSE_CREATE_ASKING = null;
  ${grab('function paintMuseOption(')}
  ${grab('function museCreateAsk(')}
  return { paintMuseOption, museCreateAsk, state: () => MUSE_CREATE, set: (v) => { MUSE_CREATE = v; } };
`);

function page(answers) {
  const els = { 'create-provider': menu('create-provider'), 'd-provider': menu('d-provider') };
  const doc = { getElementById: (id) => els[id] || null };
  const calls = { fetch: 0, gone: 0 };
  const fetch = async () => {
    calls.fetch += 1;
    const a = answers.shift();
    if (a === 'throw') throw new Error('offline');
    return { ok: true, json: async () => a };
  };
  const api = load(doc, fetch, null, () => 'anthropic', () => { calls.gone += 1; });
  return { api, els, calls };
}

test('#3939 3c-3b: the create form offers Meta only when Muse is on, installed and signed in', async () => {
  const cases = [
    [{ enabled: false }, true, ''],
    [{ enabled: true, installed: false, signedIn: false }, true, 'Set up in Settings: Add a provider'],
    [{ enabled: true, installed: true, signedIn: false }, true, 'Set up in Settings: Add a provider'],
    [{ enabled: true, installed: true, signedIn: true }, false, ''],
  ];
  for (const [answer, disabled, off] of cases) {
    const p = page([answer]);
    await p.api.museCreateAsk();
    const o = p.els['create-provider'].opt('meta');
    assert.equal(o.disabled, disabled, JSON.stringify(answer));
    assert.equal(o.dataset.off || '', off, JSON.stringify(answer));
  }
});

test('#3939 3c-3b: not read yet shows today\'s option (disabled, no reason), never a guess', () => {
  const p = page([]);
  p.api.paintMuseOption(p.els['create-provider'], '');
  assert.equal(p.els['create-provider'].opt('meta').disabled, true);
  assert.equal(p.els['create-provider'].opt('meta').dataset.off, undefined);
});

test('#3939 3c-3b: a failed read keeps the last good answer', async () => {
  const p = page([{ enabled: true, installed: true, signedIn: true }, 'throw']);
  await p.api.museCreateAsk();
  await p.api.museCreateAsk();
  assert.equal(p.calls.fetch, 2, 'CONTROL: the second read was made');
  assert.equal(p.els['create-provider'].opt('meta').disabled, false);
  assert.deepEqual(p.api.state(), { on: true, installed: true, ready: true });
});

test('#3939 3c-3b: turned off here is not asked again; turned on is asked on every paint', async () => {
  const off = page([{ enabled: false }, { enabled: true, installed: true, signedIn: true }]);
  await off.api.museCreateAsk();
  await off.api.museCreateAsk();
  assert.equal(off.calls.fetch, 1, 'a board with the flag off must not re-ask per paint');
  const on = page([{ enabled: true, installed: true, signedIn: false }, { enabled: true, installed: true, signedIn: true }]);
  await on.api.museCreateAsk();
  await on.api.museCreateAsk();
  assert.equal(on.calls.fetch, 2, 'CONTROL: signed out is asked again, so signing in shows without a reload');
  assert.equal(on.els['create-provider'].opt('meta').disabled, false);
});

test('#3939 3c-3b: the agent page offers Meta only as the agent\'s current provider', async () => {
  const p = page([{ enabled: true, installed: true, signedIn: true }]);
  await p.api.museCreateAsk();
  const d = p.els['d-provider'];
  p.api.paintMuseOption(d, 'anthropic');
  assert.equal(d.opt('meta').disabled, true, 'no switch onto Meta, even signed in');
  p.api.paintMuseOption(d, 'meta');
  assert.equal(d.opt('meta').disabled, false);
});

test('#3939 3c-3b: a Meta pick a read turns off goes back, and only then', async () => {
  const p = page([{ enabled: true, installed: true, signedIn: false }]);
  p.els['create-provider'].value = 'meta';
  await p.api.museCreateAsk();
  assert.equal(p.calls.gone, 1);
  const q = page([{ enabled: true, installed: true, signedIn: false }]);
  await q.api.museCreateAsk();
  assert.equal(q.calls.gone, 0, 'CONTROL: nothing to undo when Meta is not the pick');
});

// createPickGone, with the pieces it calls stubbed to the smallest honest shape.
// eslint-disable-next-line no-new-func
const goneLoad = new Function('document', 'MUSE_CREATE', `
  const CREATE_ACCOUNTS = [];
  const acctProvider = (x) => x.provider;
  const vendorPicksModel = (p) => p === 'meta';
  const switchKeyedWord = () => 'Meta Muse';
  const applyCreateProviderUI = () => {};
  ${grab('function createPickGone(')}
  return createPickGone;
`);

function goneSays(museCreate) {
  const pv = { value: 'meta', selectedIndex: 0, options: [{ value: 'meta', disabled: true }] };
  const why = { textContent: '', hidden: true };
  const doc = { getElementById: (id) => (id === 'create-provider' ? pv : id === 'create-model-why' ? why : null) };
  goneLoad(doc, museCreate)(true);
  return { prov: pv.value, why: why.textContent };
}

test('#3939 3c-3b: the "back on Claude" sentence names the real reason', () => {
  const off = goneSays({ on: false, installed: false, ready: false });
  assert.equal(off.prov, 'anthropic');
  assert.match(off.why, /^Meta Muse is not available on this computer, so this is back on Claude\.$/);
  const notSetUp = goneSays({ on: true, installed: false, ready: false });
  assert.match(notSetUp.why, /^Meta Muse is not set up on this computer, .*Set it up in Settings, AI Models: Add a provider, then Meta\.$/);
  const signedOut = goneSays({ on: true, installed: true, ready: false });
  assert.match(signedOut.why, /^Meta Muse is not signed in on this computer, .*Sign in to it in Settings, AI Models: Add a provider, then Meta\.$/);
});
