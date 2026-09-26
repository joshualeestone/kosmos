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
  assert.equal(m.opt('antigravity').dataset.off, 'Set up in Settings: Add a provider');
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
  assert.match(PAGE, /: toAgy\s*\n\s*\? 'Its ' \+ fromWord \+ ' model and account choices do not cross: Gemini picks its own model, and it runs on your Google subscription through Antigravity\. If Antigravity is not signed in yet, sign in first: in Settings, AI Models, choose Add a provider, then Google Gemini\.'/);
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
  const el = (id) => (els[id] || (els[id] = { id, textContent: '', hidden: true, href: '', value: '', attrs: {},
    listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute(k, v) { this.attrs[k] = v; },
    hasAttribute(k) { return k in this.attrs; }, focus() { doc.activeElement = this; } }));
  const posts = [];
  const doc = { getElementById: (id) => el(id) };
  const bodies = [];
  const fetchStub = async (path, opts) => {
    posts.push(path);
    if (opts && opts.body) bodies.push([path, opts.body]);
    // #3998: one address is both read (GET) and started (POST), so an answer can name its method.
    const method = (opts && opts.method) || 'GET';
    const queue = answers[method + ' ' + path] || answers[path] || [];
    const a = queue.length > 1 ? queue.shift() : queue[0];
    if (a === 'throw') throw new Error('offline');
    return { json: async () => a };
  };
  let painted = 0;
  // eslint-disable-next-line no-new-func
  const successes = [];
  const api = new Function('document', 'fetch', 'paintAgyOption', 'frPaintKeyed', 'setTimeout', 'acctShowSuccess', 'frCheckRow', 'paintAccounts', `
    let AGY_INSTALLED = null; let AGY_OFFERED = null;
    ${PAGE.slice(at, end)}
    return { FR_AGY_SUB, ACCT_AGY_SUB, ready: () => FR_AGY_READY, offered: () => AGY_OFFERED };
  `)(doc, fetchStub, () => {}, () => { painted += 1; }, (fn) => setImmediate(fn),
    (label, box) => successes.push([label, box]), (o) => 'BOX:' + o.title + '|' + o.detail, async () => {});
  const view = () => ({ text: el('fr-gemini-sub-code').textContent, button: el('fr-gemini-sub-go').hidden ? '' : el('fr-gemini-sub-go').textContent,
    stop: !el('fr-gemini-sub-cancel-row').hidden });
  const settle = async (pred, n = 200) => { for (let i = 0; i < n && !pred(); i++) await new Promise((r) => setImmediate(r)); };
  return { ...api, view, posts, bodies, el, settle, successes, painted: () => painted };
}

test('#3998: Sign in with Subscription walks not installed -> Install -> Sign in (hidden) -> paste the code -> Ready, with no Terminal', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: false, signedIn: false }],
    '/api/antigravity/install': [{ ok: true, installed: true }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'a1b2c3d4e5f60718', state: 'starting' }],
    'GET /api/antigravity/signin': [{ id: 'a1b2c3d4e5f60718', state: 'starting' }, { id: 'a1b2c3d4e5f60718', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1' },
      { id: 'a1b2c3d4e5f60718', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1' }, { id: 'a1b2c3d4e5f60718', state: 'setup', step: 'terms' }, { id: 'a1b2c3d4e5f60718', state: 'done' }],
    '/api/antigravity/signin/code': [{ ok: true, state: 'checking' }],
  });
  await f.FR_AGY_SUB.start();
  assert.match(f.view().text, /not on this computer yet/);
  assert.equal(f.view().button, 'Install Antigravity');
  assert.equal(f.view().stop, true, 'Stop is offered during the step');
  await f.FR_AGY_SUB.start();   // Install
  assert.match(f.view().text, /Antigravity is installed\. Now sign in/);
  assert.equal(f.view().button, 'Sign in with Google');
  assert.deepEqual(f.posts, ['/api/antigravity/check', '/api/antigravity/install'], 'a fresh install must not spend a check');
  await f.FR_AGY_SUB.start();   // Sign in with Google: the hidden sign-in starts
  assert.ok(!f.posts.includes('/api/antigravity/open'), 'the old Terminal route was used');
  await f.settle(() => !f.el('fr-gemini-sub-paste-row').hidden);
  assert.match(f.view().text, /copy the code Google shows and paste it below/);
  assert.equal(f.el('fr-gemini-sub-page').attrs.href, 'https://accounts.google.com/o/oauth2/auth?x=1', 'no way back to Google\'s page');
  f.el('fr-gemini-sub-paste').value = '4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n';
  await f.FR_AGY_SUB.sendCode();
  assert.deepEqual(f.bodies.find(([p]) => p === '/api/antigravity/signin/code'), ['/api/antigravity/signin/code', JSON.stringify({ code: '4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n', id: 'a1b2c3d4e5f60718' })],
    'the code did not name the sign-in it is for (another tab\'s sign-in could take it)');
  await f.settle(() => f.ready());
  assert.match(f.view().text, /^Ready\./);
  assert.equal(f.view().button, '');
  assert.equal(f.view().stop, false, 'no Stop once it is ready');
  assert.equal(f.painted(), 1, 'the row must be repainted as connected');
});

test('#3998: Settings ends a signed-in Gemini subscription on the gold connected box, like GPT and Grok', async () => {
  const f = agyFlow({ '/api/antigravity/check': [{ installed: true, signedIn: true }] });
  await f.ACCT_AGY_SUB.start();
  assert.equal(f.successes.length, 1, 'no success shown');
  assert.equal(f.successes[0][1], 'BOX:Gemini is connected|Signed in with your Google subscription, through Antigravity on this computer.');
});

test('#3998: a failed or stuck hidden sign-in says why, offers the window only when stuck, and leaving stops it', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'feedc0de00000001' }],
    'GET /api/antigravity/signin': [{ id: 'feedc0de00000001', state: 'stuck', because: 'Kosmos could not find the Done button on Antigravity\'s terms' }],
    '/api/antigravity/signin/stop': [{ ok: true }],
  });
  await f.FR_AGY_SUB.start();
  assert.equal(f.view().button, 'Sign in with Google');
  await f.FR_AGY_SUB.start();
  await f.settle(() => !f.el('fr-gemini-sub-show-row').hidden);
  f.FR_AGY_SUB.leave();   // first, so a failed assertion below never leaves the follow loop running
  assert.match(f.view().text, /^Kosmos could not find the Done button on Antigravity's terms\. Show the sign-in window/);
  assert.ok(f.posts.includes('/api/antigravity/signin/stop'), 'leaving the step left the hidden sign-in running');
  assert.deepEqual(f.bodies.find(([p]) => p === '/api/antigravity/signin/stop'), ['/api/antigravity/signin/stop', JSON.stringify({ id: 'feedc0de00000001' })],
    'Stop did not name its own sign-in, so it could end another tab\'s');
  const g = agyFlow({ '/api/antigravity/check': [{ installed: true, signedIn: null }], 'POST /api/antigravity/signin': [{ ok: true }],
    'GET /api/antigravity/signin': [{ state: 'failed', because: 'Antigravity asked to trust a folder Kosmos did not choose, so Kosmos stopped the sign-in' }] });
  await g.FR_AGY_SUB.start(); await g.FR_AGY_SUB.start();
  await g.settle(() => /did not choose/.test(g.view().text));
  assert.match(g.view().text, /^Antigravity asked to trust a folder Kosmos did not choose/);
  assert.equal(g.view().button, 'Sign in with Google', 'a failed sign-in offers it again');
  assert.equal(g.el('fr-gemini-sub-show-row').hidden, true);
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
  assert.match(f.view().text, /not available on this computer\. Press Stop this sign-in to use an API key instead/);
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

test('#3568: an Antigravity agent\'s page says there is no account to move it to, never a key or a Settings path (review round 7)', async () => {
  const els = { 'd-account': { innerHTML: 'x', disabled: false }, 'd-account-go': { disabled: false }, 'd-account-msg': { textContent: '' } };
  let fetched = 0;
  // eslint-disable-next-line no-new-func
  const paint = new Function('document', 'fetch', 'ACCOUNTS', 'ACCOUNTS_UNREADABLE', `
    ${grab('async function paintAccountPicker(')}
    return paintAccountPicker;
  `)({ getElementById: (id) => els[id] }, () => { fetched += 1; return new Promise(() => {}); }, [], false);
  await paint(require('./test-support/fleet').agent('gem', { runner: 'antigravity' }));   // a real card, not a hand-built one
  assert.equal(els['d-account-msg'].textContent, 'It runs on your Google subscription through Antigravity, so there is no account to move it to.');
  assert.equal(els['d-account'].disabled, true);
  assert.equal(els['d-account-go'].disabled, true);
  assert.equal(fetched, 0, 'it must not read accounts for an agent that has none');
});

test('#3568: an install whose answer never came says it may still be installing, not that it failed (review round 7)', async () => {
  const f = agyFlow({ '/api/antigravity/check': [{ installed: false, signedIn: false }], '/api/antigravity/install': ['throw'] });
  await f.FR_AGY_SUB.start();
  await f.FR_AGY_SUB.start();   // Install, whose request drops
  assert.match(f.view().text, /may still be installing/);
  assert.doesNotMatch(f.view().text, /could not install/);
  assert.equal(f.view().button, 'Check again');
});

test('#3568: a saved Gemini-by-subscription create pick waits for the installed read before it is judged (review round 8)', () => {
  const at = PAGE.indexOf('      const pref = readCreatePrefs();');
  const next = PAGE.slice(at, at + 600);
  assert.match(next, /if \(pref && pref\.provider === 'antigravity'\) \{\s*await agyAsk\(\);[\s\S]{0,160}if \(gen !== EXTRAS_GEN \|\| CREATE_PROVIDER_TOUCHED\) return;/);
  assert.ok(PAGE.lastIndexOf('async function loadCreateExtras', at) > PAGE.lastIndexOf('\nfunction ', at), 'the restore must sit inside the async loadCreateExtras');
});

test('#3998: a sign-in another tab started since is not this step\'s to follow', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'aaaaaaaaaaaaaaaa' }],
    'GET /api/antigravity/signin': [{ id: 'bbbbbbbbbbbbbbbb', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=2' }],
  });
  await f.FR_AGY_SUB.start(); await f.FR_AGY_SUB.start();
  await f.settle(() => /somewhere else/.test(f.view().text));
  assert.match(f.view().text, /^A sign-in started somewhere else, so this one stopped\./);
  assert.equal(f.el('fr-gemini-sub-paste-row').hidden, true, 'this step offered to paste a code into another tab\'s sign-in');
  assert.equal(f.view().button, 'Sign in with Google');
});

test('#3998 round 4: leaving while the sign-in is still starting stops the sign-in that press began', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'c0ffee0000000001' }],
    '/api/antigravity/signin/stop': [{ ok: true }],
  });
  await f.FR_AGY_SUB.start();   // Check: not signed in, offers Sign in with Google
  const pending = f.FR_AGY_SUB.start();   // the start request is in flight...
  f.FR_AGY_SUB.leave();          // ...and the person closes the step
  await pending;
  await f.settle(() => f.posts.includes('/api/antigravity/signin/stop'));
  assert.deepEqual(f.bodies.find(([p]) => p === '/api/antigravity/signin/stop'), ['/api/antigravity/signin/stop', JSON.stringify({ id: 'c0ffee0000000001' })],
    'the sign-in started as the step closed kept running out of sight');
});

test('#3998 round 4: the status line is rewritten only when its words change (a live region re-reads every write)', () => {
  const at = PAGE.indexOf('function agySubDriver(');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at));
  assert.match(src, /if \(code\.textContent !== text\) code\.textContent = text;/);
});

test('#3998 round 5: a code that came back refused puts the cursor in the paste box again', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'abad1dea00000001' }],
    'GET /api/antigravity/signin': [{ id: 'abad1dea00000001', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1' },
      { id: 'abad1dea00000001', state: 'checking' },
      { id: 'abad1dea00000001', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1', because: 'Antigravity did not take that code. Copy the newest code from Google\'s page and paste it again.' }],
  });
  await f.FR_AGY_SUB.start(); await f.FR_AGY_SUB.start();
  await f.settle(() => !f.el('fr-gemini-sub-paste-row').hidden);
  const box = f.el('fr-gemini-sub-paste');
  let focuses = 0; box.focus = () => { focuses += 1; };
  await f.settle(() => /did not take that code/.test(f.view().text), 400);
  f.FR_AGY_SUB.leave();
  assert.match(f.view().text, /did not take that code/, 'CONTROL: the refusal was shown');
  assert.ok(focuses >= 1, 'the cursor was left where it was after the code came back refused');
});

test('#3998 round 6: the paste box is focused once, not on every poll (Tab must be able to leave it)', async () => {
  const code = { id: 'f0cus0000000001', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1' };
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'f0cus0000000001' }],
    'GET /api/antigravity/signin': [code, code, code, code, code, code],
  });
  let focuses = 0;
  f.el('fr-gemini-sub-paste').focus = () => { focuses += 1; };
  await f.FR_AGY_SUB.start(); await f.FR_AGY_SUB.start();
  await f.settle(() => f.posts.filter((p) => p === '/api/antigravity/signin').length >= 6, 600);
  f.FR_AGY_SUB.leave();
  assert.ok(f.posts.filter((p) => p === '/api/antigravity/signin').length >= 5, 'CONTROL: several polls ran');
  assert.equal(focuses, 1, 'the box took focus back ' + focuses + ' times');
});

test('#3998 round 6: why a pasted code was refused stays on screen until the person types again', async () => {
  const code = { id: 'c0de00000000001', state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1' };
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: 'c0de00000000001' }],
    'GET /api/antigravity/signin': [code, code, code, code],
    '/api/antigravity/signin/code': [{ ok: false, error: 'that does not look like the code from Google\'s page' }],
  });
  await f.FR_AGY_SUB.start(); await f.FR_AGY_SUB.start();
  await f.settle(() => !f.el('fr-gemini-sub-paste-row').hidden);
  f.el('fr-gemini-sub-paste').value = 'nope';
  await f.FR_AGY_SUB.sendCode();
  const polls = f.posts.length;
  await f.settle(() => f.posts.length >= polls + 2, 400);
  const text = f.view().text;
  f.FR_AGY_SUB.leave();
  assert.match(text, /^That does not look like the code/, 'the next poll wrote over the refusal: ' + text);
});

test('#3998 round 6: once the window is shown, the panel says to finish there and offers no second window', async () => {
  const f = agyFlow({
    '/api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/signin': [{ ok: true, id: '5h0wn0000000001' }],
    'GET /api/antigravity/signin': [{ id: '5h0wn0000000001', state: 'stuck', shown: true, because: 'x' }],
  });
  await f.FR_AGY_SUB.start(); await f.FR_AGY_SUB.start();
  await f.settle(() => /window is open/.test(f.view().text));
  f.FR_AGY_SUB.leave();
  assert.match(f.view().text, /^The sign-in window is open\. Finish it there/);
  assert.equal(f.el('fr-gemini-sub-show-row').hidden, true, 'a second Show would open another window');
});

test('#3998 round 8: hiding the paste row with focus in it moves focus to Stop, not behind the dialog', () => {
  const f = agyFlow({ '/api/antigravity/check': [{ installed: true, signedIn: null }] });
  const row = f.el('fr-gemini-sub-paste-row');
  const box = f.el('fr-gemini-sub-paste');
  row.hidden = false; row.contains = (x) => x === box;
  f.el('fr-gemini-sub-cancel-row').hidden = false;
  let moved = null;
  f.el('fr-gemini-sub-cancel').focus = () => { moved = 'cancel'; };
  box.focus();   // the flow's own document now has focus in the paste box
  f.FR_AGY_SUB.rows(false, false);
  assert.equal(row.hidden, true);
  assert.equal(moved, 'cancel', 'focus was left in a hidden row');
});
