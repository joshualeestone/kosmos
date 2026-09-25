'use strict';

/**
 * #718: the service worker's two PURE functions, behind the node gate.
 *
 * `boardUrlFor` is the arbitrary-navigation boundary -- its output is handed
 * straight to clients.openWindow()/navigate() in notificationclick -- and
 * `notificationFor` maps the coordinator's real EventSummary payload
 * {kind, agent, project, id, address, session} into the shown notification. Both were
 * previously exercised only by docs/browser-checks/render-push-718.js, which
 * does not run in `yarn test` and only delivers one happy-path payload; it never
 * proves the allowlist REJECTS a hostile address. These are pure functions, so a
 * node test can eval them from the worker source and pin both the happy path and
 * the rejection path where the pre-PR gate can see them.
 *
 * HOW: sw.js is a service worker (top-level `self.addEventListener(...)`), so it
 * cannot be `require`d in node. We eval it inside `new Function` with a `self`
 * stub whose addEventListener is a no-op, and return the two functions from the
 * worker's own scope. Nothing in this file calls the registered handlers, so the
 * stubbed globals are never dereferenced.
 *
 *   node --test web.sw-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'web', 'sw.js'), 'utf8');
// eslint-disable-next-line no-new-func
const factory = new Function('self', 'caches', src + '\nreturn { boardUrlFor, notificationFor };');
const selfStub = { addEventListener() {}, location: { origin: 'https://board.example' } };
const { boardUrlFor, notificationFor } = factory(selfStub, {});

test('boardUrlFor builds an https URL only from a valid hostname address', () => {
  assert.equal(boardUrlFor({ address: 'study.kosmos.io' }), 'https://study.kosmos.io/');
  assert.equal(boardUrlFor({ address: 'a.b.example.com' }), 'https://a.b.example.com/');
  assert.equal(boardUrlFor({ address: 'mac-1.nonprod.example.com' }), 'https://mac-1.nonprod.example.com/');
});

test('boardUrlFor REJECTS hostile or malformed addresses (the arbitrary-navigation boundary)', () => {
  // A colon (scheme), a slash (path), an @ (userinfo), or whitespace must never
  // survive -- each is how a value could become a `javascript:` URI, a foreign
  // path, or a spoofed origin once it reaches openWindow()/navigate().
  for (const bad of [
    'javascript:alert(1)',
    'evil.com/path',
    'user@evil.com',
    'has space.com',
    'https://evil.com',        // a full URL is not a bare hostname
    'nohost',                  // single label, no dot
    '',
    '.leadingdot.com',
    'trailingdot.',
  ]) {
    assert.equal(boardUrlFor({ address: bad }), '/', 'must reject: ' + JSON.stringify(bad));
  }
  assert.equal(boardUrlFor({}), '/');
});

test('boardUrlFor does NOT honor a `url` field (removed passthrough)', () => {
  // A `url` alone is ignored (the coordinator never sends one); a hostile `url`
  // alongside a valid `address` still resolves to the address, never the url.
  assert.equal(boardUrlFor({ url: 'https://evil.com' }), '/');
  assert.equal(boardUrlFor({ url: 'javascript:alert(1)' }), '/');
  assert.equal(boardUrlFor({ url: 'javascript:alert(1)', address: 'ok.example.com' }), 'https://ok.example.com/');
});

function ev(payload) { return { data: { json: () => payload } }; }

test('notificationFor maps the coordinator payload to who/what + a Mac click-through', () => {
  const { title, options } = notificationFor(ev({
    kind: 'needs_you', agent: 'Scorpion', project: 'Kosmos Inside Out',
    id: 'evt-1', address: 'study.kosmos.io',
  }));
  assert.equal(title, 'Scorpion needs you');
  assert.equal(options.body, 'In Kosmos Inside Out');
  assert.equal(options.data.url, 'https://study.kosmos.io/');
  assert.equal(options.tag, 'kosmos-evt-1');
});

test('notificationFor renders each kind, and falls back safely', () => {
  assert.equal(notificationFor(ev({ kind: 'posted', agent: 'Sonya' })).title, 'Sonya posted an update');
  assert.equal(notificationFor(ev({ kind: 'replied', agent: 'Sonya' })).title, 'Sonya replied');
  assert.equal(notificationFor(ev({ kind: 'weird', agent: 'Sonya' })).title, 'Sonya has an update');
  // No agent -> a generic actor, never undefined text.
  assert.equal(notificationFor(ev({ kind: 'needs_you' })).title, 'An agent needs you');
  // No project -> a plain prompt, not an empty body.
  assert.equal(notificationFor(ev({ kind: 'needs_you', agent: 'Raiden' })).options.body,
    'Open Kosmos to see what happened.');
  // No address -> the board on this origin, not a broken link.
  assert.equal(notificationFor(ev({ kind: 'needs_you', agent: 'Raiden' })).options.data.url, '/');
});

test('notificationFor honors an explicit title/body and survives a payload-less push', () => {
  const explicit = notificationFor(ev({ title: 'Custom', body: 'Text' }));
  assert.equal(explicit.title, 'Custom');
  assert.equal(explicit.options.body, 'Text');
  // A push with no data at all must not throw and must render a default.
  const none = notificationFor({ data: null });
  assert.ok(none.title && none.options.body, 'a payload-less push produced an empty notification');
  // A valid but NON-OBJECT body (JSON null, a number, a bare string) must also
  // render a default rather than throwing on a property read and dropping the push.
  for (const weird of [null, 42, 'a bare string', true]) {
    const n = notificationFor(ev(weird));
    assert.ok(n.title && n.options.body, 'a non-object push body (' + JSON.stringify(weird) + ') was dropped');
  }
});

test('#718: a tap opens the agent the push names, as the board\'s own link', () => {
  assert.equal(boardUrlFor({ address: 'study.kosmos.io', session: 'april' }), 'https://study.kosmos.io/?tab=detail&agent=april');
  assert.equal(boardUrlFor({ address: 'study.kosmos.io', session: 'leo-2_x' }), 'https://study.kosmos.io/?tab=detail&agent=leo-2_x');
  // The longest accepted id is 64, the same bound as the coordinator's.
  assert.equal(boardUrlFor({ session: 'a'.repeat(64) }), '/?tab=detail&agent=' + 'a'.repeat(64));
  // No address: the agent on this origin.
  assert.equal(boardUrlFor({ session: 'april' }), '/?tab=detail&agent=april');
  // The shown notification carries it.
  const { options } = notificationFor({ data: { json: () => ({ kind: 'needs_you', agent: 'April', address: 'study.kosmos.io', session: 'april' }) } });
  assert.equal(options.data.url, 'https://study.kosmos.io/?tab=detail&agent=april');
});

test('#718: a session that is not a plain id is dropped, never put in the URL', () => {
  for (const bad of ['', '-april', '_april', 'April', 'apr.il', '../x', 'a/b', '/a', 'a:1', 'https://evil.com',
    '//evil.com', 'a%2fb', 'a?x=1', 'a#x', 'a&agent=b', 'a b', 'a\n', 'a\u0000', '\u00e9', 'a'.repeat(65),
    'javascript:alert(1)', null, 7, {}, ['a']]) {
    assert.equal(boardUrlFor({ address: 'study.kosmos.io', session: bad }), 'https://study.kosmos.io/', 'must drop: ' + JSON.stringify(bad));
    assert.equal(boardUrlFor({ session: bad }), '/', 'must drop: ' + JSON.stringify(bad));
  }
  // A hostile address still falls back to this origin even with a good session.
  assert.equal(boardUrlFor({ address: 'javascript:alert(1)', session: 'april' }), '/?tab=detail&agent=april');
});

test('#718: a tap focuses the tab navigate() landed on, and opens a window when navigate() fails', async () => {
  const run = async (client) => {
    const handlers = {}; const opened = [];
    const self2 = { addEventListener(k, f) { handlers[k] = f; }, location: { origin: 'https://board.example' },
      clients: { matchAll: async () => [client], openWindow: async (u) => { opened.push(u); return 'window'; } } };
    factory(self2, {});
    let done;
    handlers.notificationclick({ notification: { close() {}, data: { url: 'https://board.example/?tab=detail&agent=april' } }, waitUntil(p) { done = p; } });
    return { result: await done, opened };
  };
  const landedTab = { focus: () => 'landed-focused' };
  const ok = await run({ url: 'https://board.example/', navigate: async () => landedTab, focus: () => 'old-focused' });
  assert.equal(ok.result, 'landed-focused', 'focus the page it landed on');
  assert.deepEqual(ok.opened, []);
  const refused = await run({ url: 'https://board.example/', navigate: async () => { throw new TypeError('not controlled'); }, focus: () => 'old-focused' });
  assert.deepEqual(refused.opened, ['https://board.example/?tab=detail&agent=april'], 'an uncontrolled tab: open the link instead');
  assert.equal(refused.result, 'window');
  // navigate() resolved null: the tab moved to another origin (a sign-in redirect). Focus it,
  // never open a second window.
  const redirected = await run({ url: 'https://board.example/', navigate: async () => null, focus: () => 'moved-focused' });
  assert.equal(redirected.result, 'moved-focused');
  assert.deepEqual(redirected.opened, []);
  // An engine with no navigate(): the link still lands, in a window of its own.
  const noNav = await run({ url: 'https://board.example/', focus: () => 'old-focused' });
  assert.deepEqual(noNav.opened, ['https://board.example/?tab=detail&agent=april'], 'no navigate(): open the link, never focus the old page');
});

test('#718: when the first open board tab cannot move, the next one is tried', async () => {
  const handlers = {}; const opened = [];
  const self2 = { addEventListener(k, f) { handlers[k] = f; }, location: { origin: 'https://board.example' },
    clients: { matchAll: async () => [
      { url: 'https://board.example/', navigate: async () => { throw new TypeError('not controlled'); }, focus: () => 'stale' },
      { url: 'https://board.example/x', navigate: async () => ({ focus: () => 'second-landed' }), focus: () => 'second-old' },
    ], openWindow: async (u) => { opened.push(u); return 'window'; } } };
  factory(self2, {});
  let done;
  handlers.notificationclick({ notification: { close() {}, data: { url: 'https://board.example/?tab=detail&agent=april' } }, waitUntil(p) { done = p; } });
  assert.equal(await done, 'second-landed');
  assert.deepEqual(opened, []);
});

test('#718: every name an agent can have passes the tap rule (engine/create.js NAME_RE)', () => {
  // Two copies of one fact: if agent names ever widen, a real agent would silently lose its
  // deep link. Read the engine's rule and check every short name over a hostile alphabet.
  const create = fs.readFileSync(path.join(__dirname, 'engine', 'create.js'), 'utf8');
  const m = create.match(/const NAME_RE = \/(.+)\/;/);
  assert.ok(m, 'NAME_RE moved; re-anchor');
  const NAME_RE = new RegExp(m[1]);
  const tapOk = (s) => boardUrlFor({ session: s }) !== '/';
  const alpha = 'az09_-A.+ ';
  let names = 0;
  for (const a of alpha) for (const b of alpha) for (const c of ['', ...alpha]) {
    const s = a + b + c;
    if (NAME_RE.test(s)) { names += 1; assert.ok(tapOk(s), 'an agent named ' + JSON.stringify(s) + ' would lose its deep link'); }
  }
  for (const s of ['a'.repeat(32), '0' + 'z'.repeat(31), 'a-' + '_'.repeat(30)]) if (NAME_RE.test(s)) { names += 1; assert.ok(tapOk(s), s); }
  assert.ok(names > 100, 'the sample reached real names (' + names + ')');
});

test('#718: the iOS app keeps the same session rule (ios/Kosmos/PushBridgeLogic.swift)', () => {
  // Same fact, same repo: pin it. The Swift rule is written as character ranges; read them.
  const swift = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'PushBridgeLogic.swift'), 'utf8');
  const i = swift.indexOf('static func isAgentSession(');
  assert.ok(i > 0, 'isAgentSession moved; re-anchor');
  const body = swift.slice(i, swift.indexOf('\n    }\n', i));
  assert.match(swift, /static let agentSessionMaxLength = 64\b/);
  assert.match(body, /\("a"\.\.\."z"\)\.contains\(first\) \|\| \("0"\.\.\."9"\)\.contains\(first\)\n\s*else/, 'first: a letter or digit, and nothing more');
  assert.match(body, /\("a"\.\.\."z"\)\.contains\(\$0\) \|\| \("0"\.\.\."9"\)\.contains\(\$0\) \|\| \$0 == "-" \|\| \$0 == "_"\n\s*\}/, 'rest: letters, digits, - and _, and nothing more');
  assert.match(src, /const TAP_SESSION = \/\^\[a-z0-9\]\[a-z0-9_-\]\{0,63\}\$\/;/, 'and the worker says the same');
});

test('#718: the link\'s names are the ones the board reads (agent=, tab=detail)', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(page, /const WANT_AGENT = PARAMS\.get\('agent'\);/);
  assert.match(page, /const KNOWN_TABS = \[[^\]]*'detail'/);
  assert.equal(new URL('https://x' + boardUrlFor({ session: 'april' })).searchParams.get('agent'), 'april');
});
