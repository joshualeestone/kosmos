'use strict';
/**
 * #3939 slice 3c-3b: Meta Muse in the Create Agent form. The Meta option is gated on GET /api/muse
 * (turned on here, installed, signed in), a read turned off here is asked again only after the page's
 * MUSE_OFF_RECHECK_MS, and a Meta pick
 * a read turns off goes back to the default with a sentence that names the real reason.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function grabLine(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n', at) + 1);
}
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
  ${grabLine('const MUSE_OFF_RECHECK_MS')}
  ${grab('function paintMuseOption(')}
  ${grab('function museCreateAsk(')}
  return { paintMuseOption, museCreateAsk, state: () => MUSE_CREATE, set: (v) => { MUSE_CREATE = v; }, recheckMs: MUSE_OFF_RECHECK_MS };
`);

function page(answers) {
  const els = { 'create-provider': menu('create-provider'), 'd-provider': menu('d-provider') };
  const doc = { getElementById: (id) => els[id] || null };
  const calls = { fetch: 0, gone: 0 };
  const fetch = async () => {
    calls.fetch += 1;
    const a = answers.shift();
    if (a === 'throw') throw new Error('offline');
    if (a === 500) return { ok: false, json: async () => ({ error: 'x' }) };
    return { ok: true, json: async () => a };
  };
  const api = load(doc, fetch, null, () => 'anthropic', () => { calls.gone += 1; });
  return { api, els, calls };
}

test('#3939 3c-3b: the create form offers Meta only when Muse is on, installed and signed in', async () => {
  /* #5316: the words follow the state. A plain select (the team step) shows the option's text as it is, so an enabled
     option that still said "coming soon" read as disabled (Josh 11:06). */
  const cases = [
    [{ enabled: false }, true, '', 'Meta Muse \u00b7 coming soon'],
    [{ enabled: true, installed: false, signedIn: false }, true, 'Set up in Settings, AI Models', 'Meta Muse \u00b7 set up first'],
    [{ enabled: true, installed: true, signedIn: false }, true, 'Sign in to Meta Muse first', 'Meta Muse \u00b7 sign in first'],
    [{ enabled: true, installed: true, signedIn: true }, false, '', 'Meta Muse'],
  ];
  for (const [answer, disabled, off, text] of cases) {
    const p = page([answer]);
    await p.api.museCreateAsk();
    const o = p.els['create-provider'].opt('meta');
    assert.equal(o.disabled, disabled, JSON.stringify(answer));
    assert.equal(o.dataset.off || '', off, JSON.stringify(answer));
    assert.equal(o.textContent, text, 'the option\'s words do not match its state: ' + JSON.stringify(answer));
  }
});

test('#3939 3c-3b: not read yet shows today\'s option (disabled, no reason), never a guess', () => {
  const p = page([]);
  p.api.paintMuseOption(p.els['create-provider'], '');
  assert.equal(p.els['create-provider'].opt('meta').disabled, true);
  assert.equal(p.els['create-provider'].opt('meta').dataset.off, undefined);
});

test('#3939 3c-3b: a failed read (thrown, or not ok) keeps the last good answer', async () => {
  for (const bad of ['throw', 500]) {
    const p = page([{ enabled: true, installed: true, signedIn: true }, bad]);
    await p.api.museCreateAsk();
    await p.api.museCreateAsk();
    assert.equal(p.calls.fetch, 2, 'CONTROL: the second read was made (' + bad + ')');
    assert.equal(p.els['create-provider'].opt('meta').disabled, false, String(bad));
    const { at, ...kept } = p.api.state();
    assert.deepEqual(kept, { on: true, installed: true, ready: true }, String(bad));
    assert.equal(typeof at, 'number', String(bad));
  }
});

test('#3939 3c-3b: turned off here is not asked again within the recheck window; turned on is asked on every paint', async () => {
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

test('#3939: a switched-off answer older than a minute is asked again (the preview marker can switch it on)', async () => {
  const p = page([{ enabled: false }, { enabled: true, installed: true, signedIn: true }]);
  assert.equal(p.api.recheckMs, 60000, 'the page\'s own recheck window, one minute');
  await p.api.museCreateAsk();
  p.api.set({ ...p.api.state(), at: Date.now() - p.api.recheckMs - 1 });
  await p.api.museCreateAsk();
  assert.equal(p.calls.fetch, 2, 'an old off must be asked again');
  assert.equal(p.els['create-provider'].opt('meta').disabled, false, 'and switching on shows without a reload');
  const q = page([{ enabled: false }, { enabled: true, installed: true, signedIn: true }]);
  await q.api.museCreateAsk();
  q.api.set({ ...q.api.state(), at: Date.now() - Math.floor(q.api.recheckMs / 2) });
  await q.api.museCreateAsk();
  assert.equal(q.calls.fetch, 1, 'CONTROL: a fresh off is not asked again');
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

test('#5316: the team step (tc-provider) and the agent page say the same words as its state', async () => {
  const p = page([{ enabled: true, installed: true, signedIn: true }]);
  p.els['tc-provider'] = menu('tc-provider');
  await p.api.museCreateAsk();
  const tc = p.els['tc-provider'].opt('meta');
  assert.equal(tc.disabled, false, 'Meta is not offered in the team step while Muse is ready');
  assert.equal(tc.textContent, 'Meta Muse', 'the team step still says coming soon for a usable Muse');
  // The agent page offers Meta only as an agent's current provider (switching onto Muse is not offered): its words
  // say so for any other agent, and "Meta Muse" for an agent on Muse.
  const d = p.els['d-provider'];
  p.api.paintMuseOption(d, 'anthropic');
  assert.equal(d.opt('meta').disabled, true);
  assert.equal(d.opt('meta').textContent, 'Meta Muse \u00b7 coming soon');
  p.api.paintMuseOption(d, 'meta');
  assert.equal(d.opt('meta').textContent, 'Meta Muse');
});

test('#5316: the logo list strips the new suffix as it strips "coming soon"', () => {
  const lines = PAGE.split("\n").filter((l) => /const label = .*textContent\.replace\(.*coming soon/.test(l));
  assert.equal(lines.length, 2, 'fixture: the two label lines moved: ' + lines.length);
  for (const l of lines) {
    const re = new RegExp(l.match(/replace\(\/(.*)\/i,/)[1], 'i');
    assert.equal('Meta Muse \u00b7 sign in first'.replace(re, '').trim(), 'Meta Muse', l);
    assert.equal('Meta Muse \u00b7 coming soon'.replace(re, '').trim(), 'Meta Muse', l);
    assert.equal('Meta Muse \u00b7 set up first'.replace(re, '').trim(), 'Meta Muse', l);
    assert.equal('Google Gemini (API key)'.replace(re, '').trim(), 'Google Gemini (API key)', l);
  }
});
