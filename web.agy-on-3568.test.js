'use strict';
/**
 * #3568: Gemini on a Google subscription (value 'antigravity', Google's Antigravity CLI) on the page.
 * The option is gated on agy being installed (not on an account: it signs in inside the agent's own
 * window), it is named as Gemini by subscription wherever a person picked it, and choosing it never
 * sends a Claude account or a Claude model.
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
function selectBody(id) {
  const m = PAGE.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  assert.ok(m, '#' + id + ' is gone from the page');
  return m[1];
}

test('#3568: the create and switch menus offer Gemini on a Google subscription, right after Gemini, off until checked', () => {
  for (const id of ['d-provider', 'create-provider']) {
    const body = selectBody(id);
    const agy = body.match(/<option value="antigravity"[^>]*>([^<]*)<\/option>/);
    assert.ok(agy, id + ' has no Gemini-by-subscription option');
    assert.match(agy[1], /Gemini \(Google subscription\)/);
    assert.match(agy[0], /\bdisabled\b/, 'it must start off until agy is checked');
    assert.ok(body.indexOf('value="google"') < body.indexOf('value="antigravity"'), 'it should sit after Gemini');
  }
  // CONTROL: Add a provider keeps Gemini's key path and does not list antigravity (its sign-in is the Gemini row's).
  assert.doesNotMatch(selectBody('acct-provider-pick'), /value="antigravity"/);
});

// eslint-disable-next-line no-new-func
const agy = new Function('document', 'fetch', 'CURRENT', `
  let AGY_INSTALLED = null; let AGY_OFFERED = null; let AGY_ASKING = null;
  ${grab('function paintAgyOption(')}
  const set = (v) => { AGY_INSTALLED = v; };
  const offer = (v) => { AGY_OFFERED = v; };
  return { paintAgyOption, set, offer };
`);

function menu() {
  const opts = ['anthropic', 'google', 'antigravity'].map((value) => ({ value, disabled: true, dataset: {} }));
  return { options: opts, opt: (v) => opts.find((o) => o.value === v) };
}

test('#3568: the option turns on only when agy is installed, and says why when it is off', () => {
  const api = agy(null, null, null);
  const m = menu();
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, true, 'unknown must stay off');
  assert.equal(m.opt('antigravity').dataset.off, 'Checking Antigravity');
  api.set(false);
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, true);
  assert.equal(m.opt('antigravity').dataset.off, 'Set up in Settings, guided setup');
  api.set(true);
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, false, 'installed must turn it on');
  assert.equal(m.opt('antigravity').dataset.off, undefined);
  // The provider an agent is ON stays selectable so the menu can show it, installed or not.
  api.set(false);
  api.paintAgyOption(m, 'antigravity');
  assert.equal(m.opt('antigravity').disabled, false);
  // CONTROL: it touches only its own option.
  assert.equal(m.opt('google').disabled, true);
  // Not offered here (not a Mac, or switched off): off even when installed, and says so.
  api.set(true); api.offer(false);
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, true, 'an unoffered option was enabled');
  assert.equal(m.opt('antigravity').dataset.off, 'Not on this computer');
});

test('#3568: an Antigravity agent is on antigravity, and the switch words name Gemini by subscription', () => {
  const at = PAGE.indexOf('const providerOf = (a) =>');
  const end = PAGE.indexOf("'anthropic');", at);
  assert.ok(end > at && end - at < 400, 'providerOf moved or changed shape; re-anchor');
  const src = PAGE.slice(at, end + "'anthropic');".length);
  // eslint-disable-next-line no-new-func
  const f = new Function(src + '\n' + grab('function switchKeyedWord(') + '\nreturn { providerOf, switchKeyedWord };')();
  assert.equal(f.providerOf({ runner: 'antigravity' }), 'antigravity');
  assert.equal(f.providerOf({ runner: 'claude' }), 'anthropic', 'CONTROL');
  assert.equal(f.switchKeyedWord('antigravity'), 'Gemini (Google subscription)');
  assert.equal(f.switchKeyedWord('google'), 'Gemini', 'CONTROL');
});

test('#3568: creating on Gemini by subscription sends no account: the account row is emptied and hidden', () => {
  const asel = { innerHTML: '<option value="/h/.claude">me@x</option>', value: '/h/.claude' };
  const arow = { hidden: false };
  const provSel = { value: 'antigravity', options: [] };
  const document = { getElementById: (id) => (id === 'create-account' ? asel : id === 'create-account-row' ? arow : id === 'create-provider' ? provSel : null) };
  let claudeListed = false;
  // eslint-disable-next-line no-new-func
  const fill = new Function('document', 'CREATE_ACCOUNTS', 'CREATE_ACCOUNTS_KNOWN', 'CREATE_ACCOUNTS_FAILED', `
    function paintKeyedProviderOptions() {} function paintAgyOption() {} function agyAsk() {}
    function acctProvider() { return 'anthropic'; }
    ${grab('function fillCreateAccounts(')}
    return fillCreateAccounts;
  `)(document, new Proxy([], { get(t, k) { if (k === 'filter') claudeListed = true; return t[k]; } }), true, false);
  fill();
  assert.equal(asel.value, '', 'a Claude account would be sent for an Antigravity agent');
  assert.equal(arow.hidden, true);
  assert.equal(claudeListed, false, 'it must not even list Claude accounts');
});

test('#3568: the switch dialog and the "reactivate" sentence name Gemini by subscription, never Anthropic or Claude', () => {
  assert.match(PAGE, /const toAgy = sel\.value === 'antigravity';/);
  assert.match(PAGE, /const label = toOpenai \? 'OpenAI' : \(toOther \|\| toAgy\) \? switchKeyedWord\(sel\.value\) : 'Anthropic';/);
  assert.match(PAGE, /: toAgy\s*\n\s*\? 'Its ' \+ fromWord \+ ' model and account choices do not cross: Gemini picks its own model, and it runs on your Google subscription through Antigravity\. If Antigravity is not signed in yet, sign in first: in Settings, choose Show the guided setup, then Connect on Gemini\.'/);
});

test('#3568: after a switch, the dialog says "Restarted on Gemini (Google subscription)", never Anthropic (review round 1)', () => {
  const line = PAGE.match(/\n\s*(const provName = want === 'openai' \? [^\n]*;)/);
  assert.ok(line, 'changeProviderNow\'s provName line moved; re-anchor');
  const r = PAGE.indexOf('const ACCT_KEYED_ROUTE');
  // eslint-disable-next-line no-new-func
  const provNameFor = new Function('want', PAGE.slice(r, PAGE.indexOf('\n', r)) + '\n'
    + grab('function keyOnlyProvider(') + '\n' + grab('function vendorPicksModel(') + '\n' + grab('function switchKeyedWord(') + '\n' + line[1] + '\nreturn provName;');
  assert.equal(provNameFor('antigravity'), 'Gemini (Google subscription)');
  assert.equal(provNameFor('google'), 'Gemini', 'CONTROL');
  assert.equal(provNameFor('anthropic'), 'Anthropic', 'CONTROL');
});

test('#3568: Gemini by subscription sorts beside Gemini (review round 1: it sank below the coming-soon rows)', () => {
  const at = PAGE.indexOf('const PROVIDER_ORDER = ');
  const order = JSON.parse(PAGE.slice(PAGE.indexOf('[', at), PAGE.indexOf(']', at) + 1).replace(/'/g, '"'));
  assert.equal(order.indexOf('antigravity'), order.indexOf('google') + 1);
});

/* Review round 3: the headline flow itself, "Sign in with Subscription" on the Gemini row. The page's
   FR_AGY_SUB runs as written, against a stand-in page and scripted route answers. */
function agyFlow(answers) {
  const at = PAGE.indexOf('let FR_AGY_READY = false;');
  const end = PAGE.indexOf('const KEYED_SUB_START', at);
  assert.ok(at > 0 && end > at, 'FR_AGY_SUB moved; re-anchor');
  const els = {};
  const el = (id) => (els[id] || (els[id] = { id, textContent: '', hidden: true, href: '' }));
  const posts = [];
  const doc = { getElementById: (id) => el(id) };
  const fetchStub = async (path) => {
    posts.push(path);
    const queue = answers[path] || [];
    const a = queue.length > 1 ? queue.shift() : queue[0];
    if (a === 'throw') throw new Error('offline');
    return { json: async () => a };
  };
  let painted = 0;
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'paintAgyOption', 'frPaintKeyed', `
    let AGY_INSTALLED = null; let AGY_OFFERED = null;
    ${PAGE.slice(at, end)}
    return { FR_AGY_SUB, ready: () => FR_AGY_READY, offered: () => AGY_OFFERED };
  `)(doc, fetchStub, () => {}, () => { painted += 1; });
  const view = () => ({ text: el('fr-gemini-sub-code').textContent, button: el('fr-gemini-sub-go').hidden ? '' : el('fr-gemini-sub-go').textContent,
    stop: !el('fr-gemini-sub-cancel-row').hidden });
  return { ...api, view, posts, painted: () => painted };
}

test('#3568: Sign in with Subscription walks not installed -> Install -> Open -> Check again -> Ready', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: false, signedIn: false }, { installed: true, signedIn: true }],
    '/api/antigravity/install': [{ ok: true, installed: true }],
    '/api/antigravity/open': [{ ok: true }],
  });
  await f.FR_AGY_SUB.start();
  assert.match(f.view().text, /not on this computer yet/);
  assert.equal(f.view().button, 'Install Antigravity');
  assert.equal(f.view().stop, true, 'Stop is offered during the step');
  await f.FR_AGY_SUB.start();   // Install
  assert.match(f.view().text, /Antigravity is installed\. Open it once to sign in/);
  assert.equal(f.view().button, 'Open Antigravity to sign in');
  assert.deepEqual(f.posts, ['/api/antigravity/check', '/api/antigravity/install'], 'a fresh install must not spend a check');
  await f.FR_AGY_SUB.start();   // Open
  assert.match(f.view().text, /opens Google's sign-in in your browser/);
  assert.equal(f.view().button, 'Check again');
  await f.FR_AGY_SUB.start();   // Check again
  assert.match(f.view().text, /^Ready\./);
  assert.equal(f.view().button, '');
  assert.equal(f.view().stop, false, 'no Stop once it is ready');
  assert.equal(f.ready(), true);
  assert.equal(f.painted(), 1, 'the row must be repainted as connected');
  // Opening happened exactly once, and only on its own press.
  assert.equal(f.posts.filter((p) => p === '/api/antigravity/open').length, 1);
});

test('#3568: installed but unconfirmed offers Open as its own press; a check never opens a window by itself', async () => {
  const f = agyFlow({ '/api/antigravity/check': [{ installed: true, signedIn: null }], '/api/antigravity/open': [{ ok: false, error: 'we could not open it' }] });
  await f.FR_AGY_SUB.start();
  assert.equal(f.view().button, 'Open Antigravity to sign in');
  assert.ok(!f.posts.includes('/api/antigravity/open'), 'a check opened a window by itself');
  await f.FR_AGY_SUB.start();
  assert.match(f.view().text, /^We could not open it\./, 'the server reason is shown with a capital');
  assert.equal(f.view().button, 'Open Antigravity to sign in', 'a failed open offers the open again');
});

test('#3568: Stop partway: the late answer writes nothing and a new press starts clean', async () => {
  let release;
  const f = agyFlow({ '/api/antigravity/check': [{ installed: false, signedIn: false }] });
  const pending = new Promise((r) => { release = r; });
  const g = agyFlow({ '/api/antigravity/check': [{ installed: true, signedIn: true }] });
  // Drive g with a check that answers only after Stop.
  const at = g.FR_AGY_SUB;
  const origPost = at.post.bind(at);
  at.post = async (p) => { await pending; return origPost(p); };
  const run = at.start();
  at.leave();                     // Stop
  release();
  await run;
  assert.notEqual(g.view().text.slice(0, 6), 'Ready.', 'a stopped check wrote into the closed step');
  assert.equal(g.ready(), false);
  // CONTROL: the ordinary flow still reaches its first answer.
  await f.FR_AGY_SUB.start();
  assert.match(f.view().text, /not on this computer yet/);
});

test('#3568: where it is not offered (not a Mac, or switched off) the step says so and offers nothing to press', async () => {
  const f = agyFlow({ '/api/antigravity/check': [{ installed: false, signedIn: false, offered: false }] });
  await f.FR_AGY_SUB.start();
  assert.match(f.view().text, /not available on this computer\. Use an API key instead/);
  assert.equal(f.view().button, '');
  assert.equal(f.offered(), false);
});

test('#3568: one predicate says which providers pick their own model (review round 4: three sites were missed one by one)', () => {
  const r = PAGE.indexOf('const ACCT_KEYED_ROUTE');
  // eslint-disable-next-line no-new-func
  const f = new Function(PAGE.slice(r, PAGE.indexOf('\n', r)) + '\n' + grab('function keyOnlyProvider(') + '\n'
    + grab('function vendorPicksModel(') + '\nreturn vendorPicksModel;')();
  for (const p of ['google', 'xai', 'antigravity']) assert.equal(f(p), true, p);
  for (const p of ['anthropic', 'openai', 'meta', '']) assert.equal(f(p), false, 'CONTROL ' + p);
  // No site still spells the pair by hand: the only copy is the helper's own body.
  assert.equal((PAGE.match(/keyOnlyProvider\([^)]*\) \|\| [a-zA-Z.]+ === 'antigravity'/g) || []).length, 1);
  // The saved create pick restores for Gemini by subscription while it is offered and installed.
  assert.match(PAGE, /\|\| \(pref\.provider === 'antigravity' && AGY_OFFERED !== false && AGY_INSTALLED === true\)/);
  // The create form's recovery and the switch's pre-refusal cover it, with its own words.
  assert.match(PAGE, /if \(cur && cur\.disabled && vendorPicksModel\(cur\.value\)\)/);
  assert.match(PAGE, /if \(vendorPicksModel\(want\) && wantOpt && wantOpt\.disabled\)/);
  assert.equal((PAGE.match(/Gemini \(Google subscription\) is not set up on this computer/g) || []).length, 2);
});

test('#3568: agyAsk returns the read it starts, so the Gemini row waits for "offered?" before its choice (review round 6)', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'fetch', 'CURRENT', 'providerOf', `
    let AGY_INSTALLED = null; let AGY_OFFERED = null; let AGY_ASKING = null;
    function paintAgyOption() {}
    ${grab('function agyAsk(')}
    return { agyAsk, offered: () => AGY_OFFERED };
  `)({ getElementById: () => null }, () => held.then(() => ({ ok: true, json: async () => ({ installed: false, enabled: true, supported: false }) })), null, () => '');
  const p = f.agyAsk();
  assert.ok(p && typeof p.then === 'function', 'agyAsk must return the promise of the read it started');
  let settled = false;
  p.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, 'the await ended before the read did');
  release();
  await p;
  assert.equal(f.offered(), false, 'after the wait, "not offered" is known');
});
