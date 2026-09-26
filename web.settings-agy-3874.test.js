'use strict';
/**
 * #3874: Settings, AI Models, Add a provider offers Gemini on a Google subscription, the choice the
 * first-run Gemini row already offers. The subscription step is the SAME driver as first run
 * (agySubDriver), a second instance painting the dialog's own ids.
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
function stubEl(id) {
  return {
    id, textContent: '', hidden: true, href: '', focused: 0, attrs: {},
    focus() { this.focused += 1; },
    hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this.onclick = fn; },
    click() { if (this.onclick) this.onclick(); },
  };
}

test('#3874: the Add a provider dialog carries the Gemini choice and every part the driver paints', () => {
  const at = PAGE.indexOf('id="acct-add-dialog"');
  const end = PAGE.indexOf('id="acct-apikey-flow"', at);
  assert.ok(at > 0 && end > at, 'dialog markup moved; re-anchor');
  const dialog = PAGE.slice(at, end);
  for (const id of ['acct-gemini-flow', 'acct-gemini-pick', 'acct-gemini-pick-sub', 'acct-gemini-pick-key', 'acct-gemini-sub-step',
    'acct-gemini-sub-go', 'acct-gemini-sub-open-row', 'acct-gemini-sub-open', 'acct-gemini-sub-code', 'acct-gemini-sub-cancel-row', 'acct-gemini-sub-cancel']) {
    assert.match(dialog, new RegExp('id="' + id + '"'), '#' + id + ' is missing from the dialog');
  }
  assert.match(dialog, /id="acct-gemini-flow" hidden/, 'the Gemini choice must start hidden');
  assert.match(dialog, /id="acct-gemini-pick-sub"[^>]*>Sign in with Subscription</);
  assert.match(dialog, /id="acct-gemini-pick-key"[^>]*>Use an API key</);
  // The driver's status line is live, as first run's is.
  assert.match(dialog, /id="acct-gemini-sub-code" role="status" aria-live="polite"/);
});

/* The two driver instances, run as written against a stand-in page. */
function drivers(answers) {
  const at = PAGE.indexOf('let FR_AGY_READY = false;');
  const end = PAGE.indexOf('const KEYED_SUB_START', at);
  assert.ok(at > 0 && end > at, 'agySubDriver moved; re-anchor');
  const els = {};
  const el = (id) => (els[id] || (els[id] = stubEl(id)));
  const posts = [];
  const fetchStub = async (path) => {
    posts.push(path);
    const queue = answers[path] || [];
    const a = queue.length > 1 ? queue.shift() : queue[0];
    return { json: async () => a };
  };
  let painted = 0;
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'paintAgyOption', 'frPaintKeyed', `
    let AGY_INSTALLED = null; let AGY_OFFERED = null;
    ${PAGE.slice(at, end)}
    return { FR_AGY_SUB, ACCT_AGY_SUB, frReady: () => FR_AGY_READY };
  `)({ getElementById: el }, fetchStub, () => {}, () => { painted += 1; });
  return { ...api, el, posts, painted: () => painted };
}

test('#3874: Settings\' sign-in paints the dialog, not the first-run row, and Ready leaves first run alone', async () => {
  const d = drivers({ '/api/antigravity/check': [{ installed: true, signedIn: true }] });
  await d.ACCT_AGY_SUB.start();
  assert.match(d.el('acct-gemini-sub-code').textContent, /^Ready\. Gemini runs on your Google subscription/);
  assert.equal(d.el('acct-gemini-sub-cancel-row').hidden, true, 'no Stop once it is ready');
  assert.equal(d.el('fr-gemini-sub-code').textContent, '', 'Settings wrote into the first-run row');
  assert.equal(d.frReady(), false, 'a Settings sign-in must not mark the first-run row connected');
  assert.equal(d.painted(), 0, 'a Settings sign-in must not repaint first run');
  // CONTROL: the first-run instance still does all of that, so the assertions above can fail.
  await d.FR_AGY_SUB.start();
  assert.match(d.el('fr-gemini-sub-code').textContent, /^Ready\./);
  assert.equal(d.frReady(), true);
  assert.equal(d.painted(), 1);
});

test('#3874: the two instances keep their own state: leaving one does not stop the other', async () => {
  const d = drivers({ '/api/antigravity/check': [{ installed: false, signedIn: false }] });
  await d.ACCT_AGY_SUB.start();
  assert.equal(d.ACCT_AGY_SUB.next, 'install');
  d.FR_AGY_SUB.leave();
  assert.equal(d.ACCT_AGY_SUB.next, 'install', 'leaving first run reset the Settings step');
  assert.equal(d.el('acct-gemini-sub-go').textContent, 'Install Antigravity');
  d.ACCT_AGY_SUB.leave();
  assert.equal(d.ACCT_AGY_SUB.next, 'check');   // CONTROL: its own leave does reset it
});

/* The dialog's choice and its buttons, as written, with the neighbours it calls stubbed. */
function choice({ offered = true } = {}) {
  const at = PAGE.indexOf('let ACCT_GEMINI_INFO = null;');
  const end = PAGE.indexOf('/* Sign in again AS an existing Grok subscription account', at);
  assert.ok(at > 0 && end > at, 'acctGeminiShow moved; re-anchor');
  const els = {};
  const el = (id) => (els[id] || (els[id] = stubEl(id)));
  const calls = [];
  const sub = { leave: () => calls.push('leave'), start: () => calls.push('start') };
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'ACCT_AGY_SUB', 'acctKeyedReveal', 'acctKeyedInstallShow', 'keyedSubReady', 'ACCT_KEYED_FOCUS', `
    ${PAGE.slice(at, end)}
    return { acctGeminiShow };
  `)({ getElementById: el }, sub,
    (w, after) => calls.push('reveal:' + w + ':' + after),
    (w) => calls.push('install:' + w),
    (w) => w === 'google' && offered,
    true);
  return { ...api, el, calls };
}

test('#3874: picking Gemini where it is offered shows the choice first, the key box hidden', () => {
  const c = choice();
  c.el('acct-apikey-flow').hidden = false;
  c.acctGeminiShow('google', { present: true });
  assert.equal(c.el('acct-gemini-flow').hidden, false);
  assert.equal(c.el('acct-gemini-pick').hidden, false);
  assert.equal(c.el('acct-gemini-sub-step').hidden, true);
  assert.equal(c.el('acct-apikey-flow').hidden, true, 'the key box showed beside the choice');
  assert.equal(c.el('acct-gemini-pick-sub').focused, 1, 'focus lands on the first choice');
  // Any other provider (or a close) puts it away and ends a check in flight.
  c.calls.length = 0;
  c.acctGeminiShow(null);
  assert.equal(c.el('acct-gemini-flow').hidden, true);
  assert.deepEqual(c.calls, ['leave']);
});

test('#3874: Sign in with Subscription starts the driver at once; Use an API key goes to the key, or the download first', () => {
  const c = choice();
  c.acctGeminiShow('google', { present: true });
  c.el('acct-gemini-pick-sub').click();
  assert.equal(c.el('acct-gemini-pick').hidden, true);
  assert.equal(c.el('acct-gemini-sub-step').hidden, false);
  assert.ok(c.calls.includes('start'), 'the check did not start on the pick');

  c.acctGeminiShow('google', { present: true });
  c.calls.length = 0;
  c.el('acct-gemini-pick-key').click();
  assert.deepEqual(c.calls, ['reveal:google:true'], 'a present Gemini CLI goes straight to the key');

  c.acctGeminiShow('google', { present: false });
  c.calls.length = 0;
  c.el('acct-gemini-pick-key').click();
  assert.deepEqual(c.calls, ['install:google'], 'a missing Gemini CLI is downloaded before the key');
});

test('#3874: Stop goes back to the choice, or to the key when the check found it not offered here', () => {
  const c = choice();
  c.acctGeminiShow('google', { present: true });
  c.el('acct-gemini-pick-sub').click();
  c.el('acct-gemini-sub-cancel').click();
  assert.equal(c.el('acct-gemini-pick').hidden, false, 'Stop did not return to the choice');
  assert.equal(c.el('acct-gemini-sub-step').hidden, true);

  const n = choice({ offered: false });
  n.acctGeminiShow('google', { present: true });
  n.el('acct-gemini-pick-sub').click();
  n.calls.length = 0;
  n.el('acct-gemini-sub-cancel').click();
  assert.ok(n.calls.includes('reveal:google:true'), 'a not-offered Stop should land on the key');
});

test('#3874: acctApikeyShow offers the choice only where the subscription is offered, after asking, and only for Gemini', () => {
  const src = grab('function acctApikeyShow(');
  const g = src.indexOf("if (which === 'google') {");
  assert.ok(g > 0, 'the Gemini branch is gone');
  const branch = src.slice(g, src.indexOf('\n    }', g));
  const ask = branch.indexOf('await agyAsk()');
  const recheck = branch.indexOf('if (visit !== ACCT_APIKEY_GEN || ACCT_APIKEY_WHICH !== which) return;', ask);
  const gate = branch.indexOf("if (keyedSubReady('google')) { acctGeminiShow('google', info); return; }", recheck);
  assert.ok(ask > 0 && recheck > ask && gate > recheck, 'ask, then re-check the visit, then gate on keyedSubReady');
  // Not offered falls through to today's path (key, or the download), unchanged.
  const after = src.slice(g + branch.length);
  assert.match(after, /if \(info && info\.present\) \{ if \(!again\) acctKeyedReveal\(which\); return; \}\s*\n\s*acctKeyedInstallShow\(which, info\);/);
  // Every open, close and switch puts the Gemini choice away.
  assert.match(src, /acctGrokShow\(null\);\s*\n\s*acctGeminiShow\(null\);/);
});

test('#3874: people are pointed at Settings\' Add a provider for it, not the guided setup', () => {
  assert.doesNotMatch(PAGE, /Connect on Gemini/);
  const conn = fs.readFileSync(nodePath.join(__dirname, 'engine', 'connections.js'), 'utf8');
  assert.doesNotMatch(conn, /Connect on Gemini/);
  assert.match(conn, /Grok and Gemini each take a subscription sign-in or a key, all in Settings,/);
  assert.equal((PAGE.match(/Add a provider, then Google Gemini\./g) || []).length, 4);
});
