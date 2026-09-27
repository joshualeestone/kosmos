'use strict';

/**
 * A direct message shows in the thread the moment Send is pressed, not when the
 * board answers.
 *
 * 🛑 WHY. On a slow Windows laptop the board took over a minute to answer a DM
 * send, and the page drew nothing until the POST returned AND the thread was read
 * again: "when I type a message, it is sitting forever before it posts". The page
 * now draws the person's words straight away, marked as sending, keeps them drawn
 * as NOT SENT when the board refused or could not be reached, and hands over to the
 * kept row once the thread holds it.
 *
 * ⚠️ THE FUNCTIONS ARE EXECUTED, the page's whole script with a DOM stub, as
 * web.post-receipt.test.js does. The POST is a promise this file holds open, which
 * is the only way to see what the screen shows WHILE the board is thinking.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pageScope() {
  const src = PAGE.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(src, 'the page has no script block');
  const written = {};
  const props = {};
  const GEOMETRY = { scrollTop: 0, scrollHeight: 0, clientHeight: 0, offsetHeight: 0 };
  /* What a box answers about its layout and children: nothing, in numbers and lists. */
  const RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  const LAYOUT = { getBoundingClientRect: () => RECT, querySelectorAll: () => [], contains: () => false };
  /* A proxy element per id that REMEMBERS what is set on it (the page parks the last
     thread read on the thread box), and answers anything else as a harmless element. */
  const el = (id) => new Proxy(function () {}, {
    get: (t, k) => {
      const own = props[id] || {};
      if (k === 'innerHTML') return written[id] || '';
      if (Object.prototype.hasOwnProperty.call(own, k)) return own[k];
      if (k === 'textContent' || k === 'value') return '';
      if (k in GEOMETRY) return GEOMETRY[k];
      if (k in LAYOUT) return LAYOUT[k];
      return el(id);
    },
    set: (t, k, v) => {
      if (k === 'innerHTML') written[id] = String(v);
      else (props[id] = props[id] || {})[k] = v;
      return true;
    },
    apply: () => el(id),
  });
  const document = {
    getElementById: (id) => el(id), querySelector: () => el('?'), querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('new'),
    documentElement: el('html'), body: el('body'), readyState: 'complete', activeElement: null,
  };
  const window = {
    addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { hash: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  /* The POST is answered by whoever holds `post`; every other request answers with
     `reads` (the thread as the board now holds it). */
  const net = { post: null, reads: { messages: [] } };
  const fetch = (url, opts) => {
    if (opts && opts.method === 'POST' && /\/api\/agent\/[^/]+\/thread$/.test(url)) {
      return new Promise((resolve, reject) => { net.post = { resolve, reject }; });
    }
    if (/\/api\/agent\/[^/]+\/thread$/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => net.reads, text: async () => '' });
    }
    return new Promise(() => {});
  };
  // eslint-disable-next-line no-new-func
  const api = new Function(
    'document', 'window', 'navigator', 'fetch', 'setInterval', 'setTimeout',
    'clearInterval', 'EventSource', 'location', 'localStorage',
    src[1] + `
    return { sendTalk, TALK_PENDING, paintTalkThread,
             open: (sessionName, name, body) => {
               /* The page's open-agent record: just the two names the thread reads. */
               CURRENT = Object.assign({}, { name: name }); CURRENT.sessionName = sessionName;
               const th = document.getElementById('d-dmthread');
               th.__lastBody = body; th.__lastName = name; th.__lastSession = sessionName;
             } };`,
  )(document, window, {}, fetch, () => 0, () => 0, () => {},
    function EventSource() {}, window.location, window.localStorage);
  return Object.assign(api, { written, net });
}

const tick = () => new Promise((r) => setImmediate(r));
const KEPT_BEFORE = { text: 'earlier words', at: '2026-09-26T10:00:00.000Z', delivery: { state: 'placed' } };

test('the message is in the thread BEFORE the board answers the send', async () => {
  const page = pageScope();
  page.open('erik', 'Erik', { messages: [KEPT_BEFORE] });
  page.sendTalk('are you there?');
  await tick();
  assert.ok(page.net.post, 'the send went to the board');
  const now = page.written['d-dmthread'] || '';
  assert.match(now, /are you there\?/, 'the words are drawn while the POST is still open');
  assert.match(now, /Sending…/, 'and marked as on their way, not as delivered');
  assert.match(now, /earlier words/, 'drawn after what was already there, not instead of it');
  assert.ok(now.indexOf('earlier words') < now.indexOf('are you there?'), 'at the bottom, where a new message goes');
});

test('a send the board kept hands over to the kept row, with no second copy', async () => {
  const page = pageScope();
  page.open('erik', 'Erik', { messages: [KEPT_BEFORE] });
  page.sendTalk('hello Erik');
  await tick();
  const kept = { text: 'hello Erik', at: new Date().toISOString(), delivery: { state: 'placed' } };
  page.net.reads = { messages: [KEPT_BEFORE, kept] };
  page.net.post.resolve({ ok: true, status: 200, json: async () => ({ delivery: { state: 'placed' }, recorded: true }) });
  for (let i = 0; i < 20; i += 1) await tick();
  const now = page.written['d-dmthread'] || '';
  assert.equal((now.match(/hello Erik/g) || []).length, 1, 'the kept row replaced the drawn one');
  assert.doesNotMatch(now, /Sending…/, 'and nothing still says it is on its way');
  assert.equal(page.TALK_PENDING.erik, undefined, 'the drawn message is let go once kept');
});

test('a send that never reached the board stays drawn, marked NOT SENT, with the reason', async () => {
  const page = pageScope();
  page.open('erik', 'Erik', { messages: [KEPT_BEFORE] });
  page.net.reads = { messages: [KEPT_BEFORE] };
  page.sendTalk('did this go?');
  await tick();
  page.net.post.reject(new Error('Failed to fetch'));
  for (let i = 0; i < 20; i += 1) await tick();
  const now = page.written['d-dmthread'] || '';
  assert.match(now, /did this go\?/, 'the words do not vanish');
  assert.match(now, /class="delivery failed">Not sent\. Failed to fetch/, 'they say plainly that they were not sent, and why');
  assert.doesNotMatch(now, /Sending…/);
});

test('a refusal the board did not keep is drawn as not sent too', async () => {
  const page = pageScope();
  page.open('erik', 'Erik', { messages: [] });
  page.net.reads = { messages: [] };
  page.sendTalk('one more');
  await tick();
  page.net.post.resolve({ ok: true, status: 200, json: async () => ({
    delivery: { state: 'could_not', because: 'it is not running just now, so we did not type anything' },
    recorded: false, recordedBecause: 'we could not write it down',
  }) });
  for (let i = 0; i < 20; i += 1) await tick();
  const now = page.written['d-dmthread'] || '';
  assert.match(now, /one more/);
  assert.match(now, /Not sent\. It is not running just now/, 'with the board\'s own reason');
  assert.doesNotMatch(now, /Nothing here yet/, 'an empty thread with a drawn message is not "nothing here"');
});
