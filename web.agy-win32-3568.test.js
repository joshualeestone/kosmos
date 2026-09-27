'use strict';
/**
 * #3568 on Windows, the page half: "Sign in with Google" for Gemini on a Google subscription shows the
 * person Google's page (opened by the board) and a code box, never a Terminal, and it is offered on
 * Windows only once the board says the Windows switch is on. The page's FR_AGY_SUB / ACCT_AGY_SUB run
 * as written against a stand-in page and scripted route answers (the web.agy-on-3568 harness, with
 * onWindows answered). The Mac flow is asserted unchanged beside it.
 *
 *   node --test web.agy-win32-3568.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function agyFlow(answers, windows) {
  const at = PAGE.indexOf('let FR_AGY_READY = false;');
  const end = PAGE.indexOf('const KEYED_SUB_START', at);
  assert.ok(at > 0 && end > at, 'FR_AGY_SUB moved; re-anchor');
  const els = {};
  // addEventListener: the merged driver (with #3998) wires its own Continue and Enter in wire().
  const el = (id) => (els[id] || (els[id] = { id, textContent: '', hidden: true, href: '', value: '', disabled: false, focus() {}, hasAttribute: () => true, setAttribute() {}, addEventListener() {} }));
  const calls = [];
  const doc = { getElementById: (id) => el(id), activeElement: null };
  const fetchStub = async (path, opts) => {
    const method = (opts && opts.method) || 'GET';
    calls.push({ path, method, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const key = method + ' ' + path;
    const queue = answers[key] || answers[path] || [];
    const a = queue.length > 1 ? queue.shift() : queue[0];
    return { json: async () => a };
  };
  const fastTimeout = (fn) => setTimeout(fn, 5);
  let painted = 0;
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'paintAgyOption', 'frPaintKeyed', 'onWindows', 'setTimeout', `
    let AGY_INSTALLED = null; let AGY_OFFERED = null;
    ${PAGE.slice(at, end)}
    return { FR_AGY_SUB, ACCT_AGY_SUB, ready: () => FR_AGY_READY };
  `)(doc, fetchStub, () => {}, () => { painted += 1; }, () => windows, fastTimeout);
  const view = (pre) => ({ text: el(pre + 'code').textContent, button: el(pre + 'go').hidden ? '' : el(pre + 'go').textContent,
    paste: !el(pre + 'paste-row').hidden, page: el(pre + 'page').href });
  return { ...api, el, view: () => view('fr-gemini-sub-'), calls, painted: () => painted };
}
async function until(pred, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 5)); }
  return false;
}
const LINK = 'https://accounts.google.com/o/oauth2/auth?client_id=x&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=s';

test('the page carries a code box, with the #3998 ids, in both places the Gemini subscription is signed in', () => {
  for (const pre of ['fr-gemini-sub-', 'acct-gemini-sub-']) {
    for (const part of ['paste-row', 'paste', 'paste-go', 'page']) assert.match(PAGE, new RegExp('id="' + pre + part + '"'), pre + part);
  }
});

test('Windows: Sign in with Google goes straight from the check to Google\'s page and the code box, then to Ready; no Terminal', async () => {
  const f = agyFlow({
    'POST /api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/win32signin': [{ ok: true, id: 's1', state: 'starting' }],
    'GET /api/antigravity/win32signin': [{ id: 's1', state: 'waiting', link: LINK, secondsLeft: 58 }, { id: 's1', state: 'waiting', link: LINK, secondsLeft: 57 },
      { id: 's1', state: 'checking' }, { id: 's1', state: 'signed-in' }],
    'POST /api/antigravity/win32signin/code': [{ ok: true, id: 's1', state: 'checking' }],
  }, true);
  await f.FR_AGY_SUB.start();
  assert.ok(await until(() => f.view().paste), 'the code box shows');
  assert.equal(f.view().page, LINK, 'the page link names the same Google page, to open it again');
  assert.match(f.view().text, /Google's sign-in page is open in your browser.*paste it here.*about a minute/);
  assert.equal(f.view().button, '', 'nothing else to press but the box');
  f.el('fr-gemini-sub-paste').value = '  4/0AXl-code  ';
  // Through the Continue button's one handler (sendCode, wired once with #3998), which hands a Windows sign-in to winCode.
  await f.FR_AGY_SUB.sendCode();
  const sent = f.calls.find((c) => c.path === '/api/antigravity/win32signin/code');
  assert.deepEqual(sent.body, { id: 's1', code: '4/0AXl-code' });
  assert.ok(!f.calls.some((c) => c.path === '/api/antigravity/signin/code'), 'a Windows code also went to the Mac sign-in');
  assert.ok(await until(() => f.ready()), 'ready');
  assert.match(f.view().text, /^Ready\./);
  assert.equal(f.view().paste, false);
  assert.equal(f.painted(), 1);
  assert.ok(!f.calls.some((c) => c.path === '/api/antigravity/open'), 'Windows never asks for a Terminal');
});

test('Windows: a sign-in that ends says why and offers Sign in with Google again; leaving mid-way stops it on the board', async () => {
  const f = agyFlow({
    'POST /api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/win32signin': [{ ok: true, id: 's2', state: 'starting' }],
    'GET /api/antigravity/win32signin': [{ id: 's2', state: 'failed', because: 'Google\'s page gives about a minute to paste the code, and that minute ran out' }],
  }, true);
  await f.FR_AGY_SUB.start();
  assert.ok(await until(() => f.view().button === 'Sign in with Google'));
  assert.match(f.view().text, /^Google's page gives about a minute/);
  const g = agyFlow({
    'POST /api/antigravity/check': [{ installed: true, signedIn: null }],
    'POST /api/antigravity/win32signin': [{ ok: true, id: 's3', state: 'starting' }],
    'GET /api/antigravity/win32signin': [{ id: 's3', state: 'waiting', link: LINK, secondsLeft: 50 }],
  }, true);
  await g.FR_AGY_SUB.start();
  assert.ok(await until(() => g.view().paste));
  g.FR_AGY_SUB.leave();
  const stop = g.calls.find((c) => c.path === '/api/antigravity/win32signin/stop');
  assert.deepEqual(stop && stop.body, { id: 's3' });
  assert.equal(g.view().paste, false);
});

test('CONTROL, the Mac: the same press still checks, then offers Sign in as its own press (no code box yet, no Windows route)', async () => {
  // #3998 replaced the Mac's "Open Antigravity to sign in" (a Terminal) with its own hidden sign-in, started by this press.
  const f = agyFlow({ 'POST /api/antigravity/check': [{ installed: true, signedIn: null }] }, false);
  await f.FR_AGY_SUB.start();
  assert.equal(f.view().button, 'Sign in with Google');
  assert.equal(f.view().paste, false);
  assert.ok(!f.calls.some((c) => /win32signin/.test(c.path)));
});

test('keyedSubReady: on Windows only once the board has said it is offered; the Mac rule is unchanged', () => {
  const line = PAGE.slice(PAGE.indexOf('const keyedSubReady = '), PAGE.indexOf(';', PAGE.indexOf('const keyedSubReady = ')) + 1);
  // eslint-disable-next-line no-new-func
  const ready = (win, offered) => new Function('onWindows', 'AGY_OFFERED', 'KEYED_SUB_START', line + '\nreturn keyedSubReady("google");')(() => win, offered, { google: () => {} });
  assert.equal(ready(true, null), false, 'Windows, not asked yet: key only');
  assert.equal(ready(true, false), false, 'Windows, switched off');
  assert.equal(ready(true, true), true, 'Windows, switched on');
  assert.equal(ready(false, null), true, 'CONTROL: the Mac before the read');
  assert.equal(ready(false, false), false, 'CONTROL: the Mac, not offered');
});
