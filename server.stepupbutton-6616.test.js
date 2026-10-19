'use strict';
/* kosmos#6616 (R01b, the board button): when this computer's Kosmos+ connector also serves /_kosmos/signin?fresh=1
   (its `capabilities` lists fresh-signin; kosmos-relay gatefresh-6616), a remote session's step-up refusal says so,
   and the board page offers one Sign in again button for it. Every arm here is on the function or on the page's own
   code, run in a sandbox: no request is sent to a gated route. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stepupbutton-6616-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TUNNEL_BIN = path.join(SANDBOX, 'no-connector');

const test = require('node:test');
const assert = require('node:assert/strict');
const { remoteStepUpRefusal, REMOTE_STEP_UP, REMOTE_STEP_UP_SIGNIN, REMOTE_STEP_UP_CLOCK, REMOTE_STEP_UP_CONNECTOR } = require('./server');
const { scriptOf, lift, liftAll } = require('./test-support/page');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const now = () => Math.floor(Date.now() / 1000);
const VIA_PLUS = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-for': '203.0.113.9' };
const req = (extra) => ({ method: 'POST', headers: { ...VIA_PLUS, ...extra } });
const BOTH = new Set(['session-headers', 'fresh-signin']);

test('R01b: a stale remote session is offered Sign in again only when the connector lists fresh-signin', () => {
  const t = now();
  // A stale session the gate forwarded: it writes both headers, here with a sign-in an hour old.
  const stale = { 'x-kosmos-session-iat': String(t - 3600), 'x-kosmos-session-second': '1' };
  const got = remoteStepUpRefusal(req(stale), '/api/agents', t, BOTH);
  assert.equal(got, REMOTE_STEP_UP_SIGNIN);
  assert.equal(got.code, 'remote_step_up', 'the code changed, so every page reading it would miss it');
  assert.equal(got.signInAgain, true);
  assert.match(got.error, /Press Sign in again/);
  // The fallback stays in the sentence: the button may be closed, or the running tunnel older than the binary.
  assert.match(got.error, /Sign out of Kosmos\+ on this page and on the Kosmos\+ sign-in site/);
  // CONTROL: the same request through a connector without fresh-signin gets today's refusal, with no button.
  const plain = remoteStepUpRefusal(req(stale), '/api/agents', t, new Set(['session-headers']));
  assert.equal(plain, REMOTE_STEP_UP);
  assert.equal('signInAgain' in plain, false);
  assert.match(plain.error, /Sign out of Kosmos\+ on this page and on the Kosmos\+ sign-in site/);
});

test('R01b: no button for a request that did not come through the gate (no session header: a proxy, or an old session)', () => {
  const t = now();
  assert.equal(remoteStepUpRefusal(req(), '/api/agents', t, BOTH), REMOTE_STEP_UP, 'a forwarded request with no gate header got the button');
  // Either header alone marks the gate (second=0 is still the gate's own word).
  assert.equal(remoteStepUpRefusal(req({ 'x-kosmos-session-second': '0' }), '/api/agents', t, BOTH), REMOTE_STEP_UP_SIGNIN);
  assert.equal(remoteStepUpRefusal(req({ 'x-kosmos-session-iat': String(t - 3600) }), '/api/agents', t, BOTH), REMOTE_STEP_UP_SIGNIN);
});

test('R01b: fresh-signin vouches for nothing by itself, and changes no other refusal', () => {
  const t = now();
  // Without session-headers the board cannot trust the headers at all, whatever else the connector says.
  assert.equal(remoteStepUpRefusal(req(), '/api/agents', t, new Set(['fresh-signin'])), REMOTE_STEP_UP_CONNECTOR);
  // A sign-in from this clock's future is a clock problem; signing in again cannot help, so no button.
  const ahead = { 'x-kosmos-session-iat': String(t + 600), 'x-kosmos-session-second': '1' };
  assert.equal(remoteStepUpRefusal(req(ahead), '/api/agents', t, BOTH), REMOTE_STEP_UP_CLOCK);
  // A fresh one still passes.
  const fresh = { 'x-kosmos-session-iat': String(t - 30), 'x-kosmos-session-second': '1' };
  assert.equal(remoteStepUpRefusal(req(fresh), '/api/agents', t, BOTH), null);
  for (const r of [REMOTE_STEP_UP_CLOCK, REMOTE_STEP_UP_CONNECTOR, REMOTE_STEP_UP]) assert.equal('signInAgain' in r, false, r.code);
});

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

function fakeDoc() {
  const els = { 'stepup-ask': { hidden: true }, 'stepup-words': { textContent: '' } };
  return { els, document: { getElementById: (id) => els[id] || null, addEventListener() {} } };
}

test('R01b page: the ask shows only for remote_step_up with signInAgain true, in the server\'s own words', () => {
  const run = (body) => {
    const d = fakeDoc();
    const later = [];
    vm.runInNewContext(lift(SCRIPT, 'showStepUpAsk') + '\nshowStepUpAsk(body);', { document: d.document, body, setTimeout: (fn) => later.push(fn) });
    // The words are written AFTER the ask is shown (an alert in a hidden element announces nothing).
    if (d.els['stepup-ask'].hidden === false) assert.equal(d.els['stepup-words'].textContent, '', 'the words were written before the ask was shown');
    later.forEach((fn) => fn());
    return d.els;
  };
  const shown = run({ ...REMOTE_STEP_UP_SIGNIN });
  assert.equal(shown['stepup-ask'].hidden, false);
  assert.equal(shown['stepup-words'].textContent, REMOTE_STEP_UP_SIGNIN.error);
  for (const body of [{ ...REMOTE_STEP_UP }, { ...REMOTE_STEP_UP_CLOCK, signInAgain: true }, { ...REMOTE_STEP_UP_SIGNIN, signInAgain: 'yes' },
    { ...REMOTE_STEP_UP_SIGNIN, error: 7 }, null, { error: 'x', signInAgain: true }]) {
    assert.equal(run(body)['stepup-ask'].hidden, true, JSON.stringify(body));
  }
});

test('R01b page: the button POSTs to the fixed gate address, and nothing in the page rewrites it', () => {
  // The gate's route is POST only (GET is 405) and answers 303, which only a navigation follows: a form, not a link.
  const form = /<form [^>]*id="stepup-form"[^>]*>[\s\S]*?<\/form>/.exec(PAGE);
  assert.ok(form, 'the Sign in again form is gone');
  assert.match(form[0], /\smethod="post"/, 'the button would send a GET, which the gate answers 405');
  assert.match(form[0], /\saction="\/_kosmos\/signin\?fresh=1"/);
  assert.match(form[0], /<button type="submit"[^>]*id="stepup-go"/, 'the button does not submit the form');
  assert.equal(/<a [^>]*id="stepup-go"/.test(PAGE), false, 'the button is a link again (a GET)');
  assert.equal(/stepup-(go|form)['"]\)\.(href|action|method|setAttribute)/.test(SCRIPT), false, 'the page sets the button\'s address from code');
});

test('R01b page: every refused fetch on the page reaches the ask (the one wrapper), 403s read as JSON', async () => {
  const start = SCRIPT.indexOf('const nativeFetch = window.fetch;');
  assert.ok(start > -1, 'the page\'s fetch wrapper is gone');
  const iife = SCRIPT.slice(SCRIPT.lastIndexOf('(() => {', start), SCRIPT.indexOf('})();', start) + 5);
  const seen = [];
  const reply = (status, body, url = 'http://board.test/api/x') => ({ ok: false, status, url, clone: () => ({ json: () => Promise.resolve(body), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }) });
  const notJson = { ok: false, status: 403, url: 'http://board.test/api/y', clone: () => ({ json: () => Promise.reject(new SyntaxError('not JSON')), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }) };
  // 'd': another computer's board (the page reads them cross-origin, credentialed) answering the same refusal.
  const win = { fetch: (u) => Promise.resolve(u === 'a' ? reply(403, { ...REMOTE_STEP_UP_SIGNIN }) : u === 'c' ? notJson
    : u === 'd' ? reply(403, { ...REMOTE_STEP_UP_SIGNIN, error: 'from elsewhere' }, 'https://other.kosmos.test/api/status')
    : reply(500, { code: 'remote_step_up', signInAgain: true })) };
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  vm.runInNewContext(liftAll(SCRIPT, ['sameOriginReply', 'requestMethod', 'requestKey']) + '\n' + iife, { window: win, URL, location: { href: 'http://board.test/', origin: 'http://board.test' }, showStepUpAsk: (b) => seen.push(b) });
  await win.fetch('a'); await win.fetch('b'); await win.fetch('c'); await win.fetch('d');
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled.length, 0, 'a 403 that is not JSON (a proxy page) left an unhandled rejection');
  assert.deepEqual(seen, [{ ...REMOTE_STEP_UP_SIGNIN }], 'a 403 did not reach the ask, or a non-403 or another origin\'s 403 did');
});

test('R01b page: only the refused write, getting through later, hides the ask; any other write, a read or another origin does not', async () => {
  const start = SCRIPT.indexOf('const nativeFetch = window.fetch;');
  const iife = SCRIPT.slice(SCRIPT.lastIndexOf('(() => {', start), SCRIPT.indexOf('})();', start) + 5);
  const box = { hidden: true };
  const words = { textContent: '' };
  let refuse = true;
  const reply = (u, ok) => ({ ok, status: ok ? 200 : 403, url: u.startsWith('http') ? u : 'http://board.test' + u,
    clone: () => ({ json: () => Promise.resolve({ ...REMOTE_STEP_UP_SIGNIN }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }) });
  // Only the gated write is refused while the session is stale (reads are never gated).
  const win = { fetch: (u, init) => {
    const url = typeof u === 'object' ? u.url : u;
    const method = String((init && init.method) || (typeof u === 'object' && u.method) || 'GET');
    return Promise.resolve(reply(url, !(refuse && method === 'POST' && url.endsWith('/api/agents'))));
  } };
  const doc = { getElementById: (id) => (id === 'stepup-ask' ? box : id === 'stepup-words' ? words : null) };
  vm.runInNewContext(liftAll(SCRIPT, ['requestMethod', 'writeRequest', 'requestKey', 'hideStepUpAsk', 'sameOriginReply', 'showStepUpAsk']) + '\n' + iife,
    { window: win, document: doc, URL, setTimeout, location: { href: 'http://board.test/', origin: 'http://board.test' } });
  await win.fetch('/api/agents', { method: 'POST' });   // refused: the ask shows, remembering POST /api/agents
  await new Promise((r) => setImmediate(r));
  assert.equal(box.hidden, false, 'the refusal did not show the ask (the arm under test never ran)');
  await win.fetch('/api/streak', { method: 'POST' });   // an ungated write that a stale session gets through
  assert.equal(box.hidden, false, 'an ungated write hid the ask though no fresh sign-in happened');
  await win.fetch('/api/agents');                      // a read of the same path
  assert.equal(box.hidden, false, 'a read hid the ask');
  await win.fetch('https://other.kosmos.test/api/agents', { method: 'POST' });
  assert.equal(box.hidden, false, 'another origin\'s write hid the ask');
  refuse = false;
  await win.fetch({ url: 'http://board.test/api/agents', method: 'POST' });   // the same write, as a Request, now through
  assert.equal(box.hidden, true, 'the refused write got through and the ask stayed up');
});
