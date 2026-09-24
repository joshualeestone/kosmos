'use strict';

/**
 * #3566: Gemini and Grok are selectable in the UI.
 *
 * The engine could already create, switch and store keys for `google` and `xai`
 * (#3484, #3490, #3509), but every door on the page said "coming soon", so the
 * backend was unreachable from the product. These pin the three doors open and
 * EXECUTE the gate that decides when Gemini/Grok are offered, because a gate read
 * as text cannot tell "offered when connected" from "always offered" or "never".
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
function optionTag(body, value) {
  const m = body.match(new RegExp('<option value="' + value + '"[^>]*>[^<]*</option>'));
  assert.ok(m, 'no ' + value + ' option');
  return m[0];
}

const routeAt = PAGE.indexOf('const ACCT_KEYED_ROUTE');
const ROUTE_SRC = PAGE.slice(routeAt, PAGE.indexOf('\n', routeAt));
// eslint-disable-next-line no-new-func
const api = new Function(ROUTE_SRC + '\n' + grab('function acctProvider(') + '\n'
  + grab('function acctOfferableTarget(') + '\n'
  + grab('function paintKeyedProviderOptions(') + '\n'
  + 'return { acctProvider, paintKeyedProviderOptions, ACCT_KEYED_ROUTE };')();

function menu() {
  const mk = (value) => ({ value, disabled: true, dataset: {} });
  return { options: ['anthropic', 'openai', 'google', 'xai', 'meta'].map(mk) };
}
const opt = (sel, v) => sel.options.find((o) => o.value === v);

test('#3566: Add a provider offers Gemini and Grok as LIVE options, the rest stay coming soon', () => {
  const body = selectBody('acct-provider-pick');
  for (const v of ['google', 'xai']) {
    const tag = optionTag(body, v);
    assert.doesNotMatch(tag, /\bdisabled\b/, v + ' is still disabled on Add a provider');
    assert.doesNotMatch(tag, /coming soon/i, v + ' still says coming soon on Add a provider');
  }
  assert.match(optionTag(body, 'meta'), /\bdisabled\b/, 'CONTROL: a genuinely coming-soon provider must stay disabled');
});

test('#3566: the create and switch menus no longer label Gemini/Grok coming soon', () => {
  for (const id of ['d-provider', 'create-provider']) {
    const body = selectBody(id);
    for (const v of ['google', 'xai']) {
      assert.doesNotMatch(optionTag(body, v), /coming soon/i, id + ' still labels ' + v + ' coming soon');
    }
  }
});

test('#3566: acctProvider maps every provider id, and unknown ids are Claude', () => {
  assert.equal(api.acctProvider({ provider: 'google' }), 'google');
  assert.equal(api.acctProvider({ provider: 'XAI' }), 'xai', 'case-insensitive, like the qualifier path');
  assert.equal(api.acctProvider({ provider: 'openai' }), 'openai');
  assert.equal(api.acctProvider({ provider: 'anthropic' }), 'anthropic');
  assert.equal(api.acctProvider({}), 'anthropic');
  assert.equal(api.acctProvider(null), 'anthropic');
  assert.deepEqual(api.ACCT_KEYED_ROUTE, { openai: 'openai', google: 'gemini', xai: 'grok' },
    'the route words must match the engine routes /api/accounts/{openai,gemini,grok}');
});

test('#3566: with the list read and no Gemini/Grok account, both are OFF and say where to connect', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [{ provider: 'anthropic', connection: { state: 'connected' } }], true, 'anthropic');
  for (const v of ['google', 'xai']) {
    assert.equal(opt(sel, v).disabled, true, v + ' is offered with no account to run it on');
    assert.equal(opt(sel, v).dataset.off, 'Connect in AI Models');
  }
});

test('#3566: a connected Gemini account turns Gemini ON, and only Gemini', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [{ provider: 'google', dir: '/h/.gemini-work1', connection: { state: 'connected' } }], true, 'anthropic');
  assert.equal(opt(sel, 'google').disabled, false, 'Gemini stays off with a connected Gemini account');
  assert.equal(opt(sel, 'google').dataset.off, undefined, 'an ON option must not carry an off reason');
  assert.equal(opt(sel, 'xai').disabled, true, 'a Gemini account must not turn Grok on');
  assert.equal(opt(sel, 'meta').disabled, true, 'CONTROL: the gate must not touch a coming-soon provider');
});

test('#3566: a Grok account the provider REJECTED does not turn Grok on', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [{ provider: 'xai', dir: '/h/.grok-work1', connection: { state: 'none' } }], true, 'anthropic');
  assert.equal(opt(sel, 'xai').disabled, true, 'a rejected key is offered as a place to run');
});

test('#3566: an UNKNOWN list keeps them off (no account to send means an unchecked env key), and says so', () => {
  const sel = menu();
  // Even a list that happens to hold a Gemini row is not trusted until it is known.
  api.paintKeyedProviderOptions(sel, [{ provider: 'google', dir: '/h/.gemini-work1', connection: { state: 'connected' } }], false, 'anthropic');
  for (const v of ['google', 'xai']) {
    assert.equal(opt(sel, v).disabled, true, v + ' is offered before the accounts were read');
    assert.equal(opt(sel, v).dataset.off, 'Checking your accounts');
  }
});

test('#3566: the provider an agent is ON stays selectable so the menu can show it', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [], true, 'xai');
  assert.equal(opt(sel, 'xai').disabled, false, 'a Grok agent could not show Grok as its current provider');
  assert.equal(opt(sel, 'google').disabled, true);
});

test('#3566: the first-run model step does not call Gemini or Grok coming soon, and says where they connect', () => {
  for (const name of ['Gemini', 'Grok']) {
    const m = PAGE.match(new RegExp('<b>' + name + '</b><small>[^<]*</small></div><span class="soon"[^>]*>([^<]*)</span>'));
    assert.ok(m, 'the first-run ' + name + ' row moved; re-anchor this test');
    assert.equal(m[1], 'After setup', 'the first-run ' + name + ' pill says ' + JSON.stringify(m[1]));
  }
  assert.match(PAGE, /id="fr-later-models"[^>]*>Gemini and Grok connect with an API key in Settings, AI Models/,
    'the first-run step no longer says where Gemini and Grok connect');
  const llama = PAGE.match(/<b>Llama<\/b><small>[^<]*<\/small><\/div><span class="soon"[^>]*>([^<]*)<\/span>/);
  assert.ok(llama && llama[1] === 'Coming soon', 'CONTROL: a genuinely unavailable provider must still say Coming soon');
});

test('#3566: the key step posts to the engine route for the picked provider, and sends no label', () => {
  const at = PAGE.indexOf("document.getElementById('acct-apikey-go').addEventListener('click'");
  assert.notEqual(at, -1, 'the Gemini/Grok Add handler is gone');
  const body = PAGE.slice(at, PAGE.indexOf('\n});', at));
  assert.match(body, /fetch\('\/api\/accounts\/' \+ p\.route \+ '\/apikey'/, 'the Add button no longer posts to the per-provider route');
  assert.match(body, /JSON\.stringify\(\{ key: key\.trim\(\), name: /, 'the body must carry the key and the display name');
  assert.doesNotMatch(body, /label:/, 'a label would be validated as a slug and refuse a person\'s words');
  assert.match(PAGE, /google: \{ route: 'gemini'/);
  assert.match(PAGE, /xai: \{ route: 'grok'/);
});

test('#3566: a Gemini agent is offered only Gemini accounts to move to (never Claude ones the engine refuses)', () => {
  const at = PAGE.indexOf('function acctMoveWorld(');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  // eslint-disable-next-line no-new-func
  const world = new Function(src + '; return acctMoveWorld;')();
  const rows = [
    { provider: 'anthropic', dir: '/h/.claude', memoryShared: true, isDefault: true, connection: { state: 'connected' } },
    { provider: 'openai', dir: '/h/.codex', isDefault: true, connection: { state: 'connected' } },
    { provider: 'google', dir: '/h/.gemini-work1', connection: { state: 'connected' } },
    { provider: 'google', dir: '/h/.gemini-work2', connection: { state: 'none' } },
    { provider: 'xai', dir: '/h/.grok-work1', connection: { state: 'connected' } },
  ];
  const g = world({ runner: 'gemini', account: { dir: '/h/.gemini-work1' } }, rows);
  assert.equal(g.isKeyed, true);
  assert.equal(g.isCodex, false, 'a Gemini agent must not be treated as codex');
  assert.deepEqual(g.movable.map((x) => x.dir), ['/h/.gemini-work1'], 'Gemini agent destinations: ' + JSON.stringify(g.movable.map((x) => x.dir)));
  const x = world({ runner: 'grok', account: null }, rows);
  assert.deepEqual(x.movable.map((r) => r.dir), ['/h/.grok-work1']);
  const c = world({ runner: 'claude', account: { dir: '/h/.claude' } }, rows);
  assert.equal(c.isKeyed, false, 'CONTROL: a Claude agent keeps the Claude branch');
  assert.deepEqual(c.movable.map((r) => r.dir), ['/h/.claude']);
});

test('#3566: a Gemini or Grok model id is never shown as a Claude model', () => {
  const at = PAGE.indexOf('function modelLine(');
  const body = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  const gi = body.indexOf("a.runner === 'gemini' || a.runner === 'grok'");
  const pre = body.indexOf("'Claude ' + name");
  assert.ok(gi > -1, 'modelLine has no Gemini/Grok arm');
  assert.ok(pre > gi, 'the Gemini/Grok arm must return before the "Claude " prefix is applied');
});

test('#3566: moving a Gemini/Grok agent between its accounts does not promise its chat comes with it', () => {
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const m = SERVER.match(/const moveChatWord = wrote\.account\s*&& (\(\{[^}]*\}\)\[String\(wrote\.account\.provider \|\| ''\)\.toLowerCase\(\)\]);/);
  assert.ok(m, 'the move route no longer derives its chat word from the provider; re-anchor');
  // eslint-disable-next-line no-new-func
  const wordFor = new Function('wrote', 'return ' + m[1] + ';');
  assert.equal(wordFor({ account: { provider: 'google' } }), 'Gemini');
  assert.equal(wordFor({ account: { provider: 'xai' } }), 'Grok');
  assert.equal(wordFor({ account: { provider: 'openai' } }), 'Codex');
  assert.equal(wordFor({ account: { provider: 'anthropic' } }), undefined,
    'CONTROL: a Claude move must keep the shared-history sentence');
});

test('#3566: a DEFAULT Gemini/Grok agent joins its own provider\'s default row, never OpenAI\'s', () => {
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const a = SERVER.indexOf('  const foreign = !!(job.runner && job.runner !== \'claude\');');
  assert.ok(a > -1, 'accountForAgent\'s dir-less match moved; re-anchor');
  const b = SERVER.indexOf('  if (found) {', a);
  // eslint-disable-next-line no-new-func
  const match = new Function('job', 'dir', 'list', SERVER.slice(a, b) + '\nreturn found;');
  const list = [
    { dir: '/h/.claude', isDefault: true },
    { dir: '/h/.codex', provider: 'openai', isDefault: true },
    { dir: '/h/.gemini', provider: 'google', isDefault: true },
  ];
  assert.equal(match({ runner: 'gemini' }, null, list).dir, '/h/.gemini', 'a default Gemini agent joined the wrong row');
  assert.equal(match({ runner: 'grok' }, null, list), undefined, 'a default Grok agent with no Grok row must join nothing, not OpenAI');
  assert.equal(match({ runner: 'codex' }, null, list).dir, '/h/.codex', 'CONTROL: codex still joins the OpenAI default');
  assert.equal(match({ runner: 'claude' }, null, list).dir, '/h/.claude', 'CONTROL: Claude still joins the Claude default');
});

test('#3566: a Gemini row and a Grok row that read alike are told apart by PROVIDER, not by path', () => {
  const grabFn = (sig) => { const at = PAGE.indexOf(sig); return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2); };
  // eslint-disable-next-line no-new-func
  const q = new Function(grabFn('function esc(') + '\n' + grabFn('function acctChosenName(') + '\n'
    + grabFn('function acctPrimaryName(') + '\n' + grabFn('function accountQualifiers(') + '\nreturn accountQualifiers;')();
  const rows = [
    { provider: 'google', dir: '/h/.gemini-work1', keyTail: 'ABCD' },
    { provider: 'xai', dir: '/h/.grok-work1', keyTail: 'ABCD' },
  ];
  const out = q(rows);
  assert.equal(out.get('/h/.gemini-work1'), 'Gemini', 'got ' + out.get('/h/.gemini-work1'));
  assert.equal(out.get('/h/.grok-work1'), 'Grok', 'got ' + out.get('/h/.grok-work1'));
});

test('#3566: once a read has FAILED the off-reason says so, and does not claim a check is running', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [], false, 'anthropic', true);
  assert.equal(opt(sel, 'google').dataset.off, 'Could not check your accounts');
  const sel2 = menu();
  api.paintKeyedProviderOptions(sel2, [], false, 'anthropic', false);
  assert.equal(opt(sel2, 'google').dataset.off, 'Checking your accounts', 'CONTROL: a pending read still says checking');
});

test('#3566 (source): a machine whose only connected provider is Gemini/Grok opens the create form on it', () => {
  // loadCreateExtras is async and fetches, so this pins the branch that decides it, beside #2097's
  // OpenAI rule, and runs its chooser on sample lists.
  const at = PAGE.indexOf('async function loadCreateExtras');
  assert.ok(at > 0, 'loadCreateExtras moved');
  const fn = PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
  assert.match(fn, /else if \(!hasClaude && !hasOpenai && known\) \{/, 'the only-keyed-provider default is gone');
  const m = fn.match(/const only = (Object\.keys\(ACCT_KEYED_ROUTE\)[\s\S]*?\);)\n/);
  assert.ok(m, 'the chooser changed shape; re-anchor');
  const lift = (sig) => { const i = PAGE.indexOf(sig); return PAGE.slice(i, PAGE.indexOf('\n}', i) + 2); };
  const r = PAGE.indexOf('const ACCT_KEYED_ROUTE');
  // eslint-disable-next-line no-new-func
  const choose = new Function('CREATE_ACCOUNTS', PAGE.slice(r, PAGE.indexOf('\n', r)) + '\n' + lift('function keyOnlyProvider(') + '\n'
    + lift('function acctProvider(') + '\n' + lift('function acctOfferableTarget(') + '\nreturn ' + m[1]);
  assert.equal(choose([{ provider: 'xai', dir: '/h/.grok-work1', connection: { state: 'connected' } }]), 'xai');
  assert.equal(choose([{ provider: 'xai', dir: '/h/.grok-work1', connection: { state: 'none' } }]), undefined,
    'CONTROL: a rejected key must not become the default');
});

test('#3566: every inline copy of the keyed-provider set agrees with ACCT_KEYED_ROUTE', () => {
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const keyed = Object.keys(api.ACCT_KEYED_ROUTE).sort();
  // The self-contained helpers that restate the set, and the server's copies of it.
  const regexCopies = PAGE.match(/\/\^\((openai\|google\|xai)\)\$\/i/g) || [];
  assert.ok(regexCopies.length >= 2, 'CONTROL: the inline regex copies were not found; re-anchor');
  for (const r of regexCopies) assert.deepEqual(r.slice(3, -4).split('|').sort(), keyed, 'a regex copy drifted: ' + r);
  const maps = [
    ...(PAGE.match(/\(\{ codex: 'openai', gemini: 'google', grok: 'xai' \}\)/g) || []),
    ...(SERVER.match(/\(\{ codex: 'openai', gemini: 'google', grok: 'xai' \}\)/g) || []),
  ];
  assert.ok(maps.length >= 2, 'CONTROL: the runner maps (acctMoveWorld, accountForAgent) were not found; re-anchor');
  const chat = SERVER.match(/const moveChatWord = wrote\.account\s*&& \((\{[^}]*\})\)/);
  assert.ok(chat, 'the move route chat-word map moved; re-anchor');
  // eslint-disable-next-line no-new-func
  const chatKeys = Object.keys(new Function('return ' + chat[1])()).sort();
  assert.deepEqual(chatKeys, keyed, 'the move route chat-word map must name exactly the keyed providers');
});

test('#3566: modelLine, run, never prefixes Claude to a Gemini or Grok model', () => {
  const at = PAGE.indexOf('function modelLine(');
  // eslint-disable-next-line no-new-func
  const modelLine = new Function('cardStOf', grab('function modelLine(') + '\nreturn modelLine;')(() => ({ pres: 'on' }));
  assert.ok(at > -1);
  assert.equal(modelLine({ runner: 'gemini', modelName: 'gemini-2.5-pro' }), 'gemini-2.5-pro');
  assert.equal(modelLine({ runner: 'grok' }), 'Grok');
  assert.equal(modelLine({ runner: 'claude', modelName: 'Opus 5' }), 'Claude Opus 5', 'CONTROL: a Claude model keeps its prefix');
});

test('#3566: a row both pickers would not both offer does not turn its provider on (one rule for "usable")', () => {
  const sel = menu();
  // A fresh "working" badge satisfies the create list's rule, but the switch list drops a live
  // check of 'none'; offering Gemini here would post a switch with no account.
  api.paintKeyedProviderOptions(sel, [{ provider: 'google', dir: '/h/.gemini-work1', connection: { state: 'none', badge: 'working' } }], true, 'anthropic');
  assert.equal(opt(sel, 'google').disabled, true, 'Gemini offered on a row the switch list would drop');
  const sel2 = menu();
  api.paintKeyedProviderOptions(sel2, [{ provider: 'google', dir: '/h/.gemini-work1', offerable: false, connection: { state: 'connected' } }], true, 'anthropic');
  assert.equal(opt(sel2, 'google').disabled, true, 'Gemini offered on a row marked unofferable');
});
