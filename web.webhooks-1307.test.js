'use strict';

/**
 * #1307: the page's webhook pieces, run from the real page source against a stub DOM, so the fast
 * suite covers them (the browser check, docs/browser-checks/render-webhooks-1307.js, covers the
 * whole flow in a real browser but is not part of `npm test`).
 *
 * - tkAdded: a webhook task reads "<name> (a webhook)", and a webhook named "operator" never
 *   reads as "You".
 * - pjsHooksPaint: the name is escaped wherever it lands (value, labels, confirm text); the full
 *   link shows only on the row being revealed; a half-typed name survives a repaint.
 *
 *   node --test web.webhooks-1307.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  const start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  // Keep an `async` in front, or an awaiting function lifts as a syntax error.
  return (SCRIPT.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '') + SCRIPT.slice(start, end);
}

/* A box whose innerHTML is kept as a string, with just enough querySelector(All) for
   pjsHooksPaint: name inputs are found by parsing the markup it wrote. `typed` stands in for what
   the person has typed into an input since the last paint. */
function stubBox() {
  const box = { typed: new Map(), focused: null };
  // Writing innerHTML replaces the inputs, so what was typed into them is gone, as in a browser.
  let html = '';
  Object.defineProperty(box, 'innerHTML', { get: () => html, set: (v) => { html = v; box.typed = new Map(); } });
  const inputs = () => [...box.innerHTML.matchAll(/<input[^>]*data-hook-name="([^"]+)"[^>]*value="([^"]*)"|<input[^>]*value="([^"]*)"[^>]*data-hook-name="([^"]+)"/g)]
    .map((m) => {
      const id = m[1] || m[4];
      const el = {
        dataset: { hookName: id },
        get value() { return box.typed.has(id) ? box.typed.get(id) : (m[2] !== undefined ? m[2] : m[3]); },
        set value(v) { box.typed.set(id, v); },
        focus() { box.focused = id; },
      };
      return el;
    });
  box.querySelectorAll = (sel) => (sel === 'input[data-hook-name]' ? inputs() : []);
  box.querySelector = (sel) => {
    const m = /data-hook-name="([^"]+)"/.exec(sel);
    return m ? inputs().find((i) => i.dataset.hookName === m[1]) || null : null;
  };
  return box;
}

function load(box) {
  const document = { getElementById: (id) => (id === 'pjs-hooks' ? box : null), activeElement: null };
  const CSS = { escape: (s) => String(s) };
  // eslint-disable-next-line no-new-func
  return new Function('document', 'CSS',
    fnSource('esc') + fnSource('agoWords') + fnSource('tkAdded') + fnSource('pjsHooksWhen') + fnSource('pjsHooksPaint')
    + 'const PJS_HOOKS = { projectId: "p", list: [], reveal: null, confirm: null, gen: 0 };'
    + 'return { tkAdded, pjsHooksPaint, PJS_HOOKS };')(document, CSS);
}

test('tkAdded: a webhook task says which webhook, and a webhook named "operator" is never "You"', () => {
  const { tkAdded } = load(stubBox());
  assert.equal(tkAdded({ addedVia: 'webhook', addedBy: 'Zapier' }), 'Zapier (a webhook)');
  assert.equal(tkAdded({ addedVia: 'webhook', addedBy: 'operator' }), 'operator (a webhook)');
  assert.equal(tkAdded({ addedVia: 'webhook' }), 'A webhook (a webhook)');
  assert.equal(tkAdded({ addedBy: 'operator', addedVia: 'screen' }), 'You', 'control: the screen still reads You');
});

test('pjsHooksPaint escapes the name everywhere it lands, and shows the link only on the revealed row', () => {
  const box = stubBox();
  const { pjsHooksPaint, PJS_HOOKS } = load(box);
  const evil = '"><img src=x onerror=alert(1)>';
  PJS_HOOKS.list = [
    { id: 'aaaaaaaaaaaaaaaa', name: evil, createdAt: new Date().toISOString(), lastUsedAt: null },
    { id: 'bbbbbbbbbbbbbbbb', name: 'Plain', createdAt: new Date().toISOString(), lastUsedAt: null },
  ];
  PJS_HOOKS.reveal = { id: 'bbbbbbbbbbbbbbbb', url: 'http://127.0.0.1:1/hooks/bbbbbbbbbbbbbbbb/SECRET' };
  PJS_HOOKS.confirm = 'aaaaaaaaaaaaaaaa';
  pjsHooksPaint();
  assert.ok(!box.innerHTML.includes('<img'), 'the name was written as markup');
  assert.ok(box.innerHTML.includes('&quot;&gt;&lt;img'), 'control: the name is there, escaped');
  assert.equal((box.innerHTML.match(/SECRET/g) || []).length, 1, 'the link shows once, on the revealed row');
  assert.ok(/data-hook="bbbbbbbbbbbbbbbb"[\s\S]*SECRET/.test(box.innerHTML), 'on the right row');
  assert.ok(box.innerHTML.includes('Anything using its link stops working'), 'the confirm is on the asked row');
  assert.match(box.innerHTML, /not used yet/);
});

test('pjsHooksPaint keeps a half-typed name through a repaint; an untouched row shows the stored name', () => {
  const box = stubBox();
  const { pjsHooksPaint, PJS_HOOKS } = load(box);
  PJS_HOOKS.list = [
    { id: 'aaaaaaaaaaaaaaaa', name: 'One', createdAt: null, lastUsedAt: null },
    { id: 'bbbbbbbbbbbbbbbb', name: 'Two', createdAt: null, lastUsedAt: null },
  ];
  pjsHooksPaint();
  box.typed.set('aaaaaaaaaaaaaaaa', 'One, half ty');
  pjsHooksPaint();
  const inputs = box.querySelectorAll('input[data-hook-name]');
  assert.equal(inputs.find((i) => i.dataset.hookName === 'aaaaaaaaaaaaaaaa').value, 'One, half ty');
  assert.equal(inputs.find((i) => i.dataset.hookName === 'bbbbbbbbbbbbbbbb').value, 'Two');
});

test('pjsHooksOpen: a read that lacks the webhook whose link is showing keeps that row (and its link)', async () => {
  const box = stubBox();
  const msg = { textContent: '' };
  const document = { getElementById: (id) => (id === 'pjs-hooks' ? box : id === 'pjs-hooks-msg' ? msg : null), activeElement: null };
  const CSS = { escape: (s) => String(s) };
  let answer = [];
  const fetch = async () => ({ ok: true, json: async () => ({ webhooks: answer }) });
  // eslint-disable-next-line no-new-func
  const pg = new Function('document', 'CSS', 'fetch',
    fnSource('esc') + fnSource('agoWords') + fnSource('asSentence') + fnSource('pjsHooksUrl') + fnSource('pjsHooksWhen')
    + fnSource('pjsHooksPaint') + fnSource('pjsHooksOpen')
    + 'const PJS_HOOKS = { projectId: "p", list: [], reveal: null, confirm: null, gen: 0 };'
    + 'return { pjsHooksOpen, PJS_HOOKS };')(document, CSS, fetch);
  const older = { id: 'aaaaaaaaaaaaaaaa', name: 'Webhook 1', createdAt: null, lastUsedAt: null };
  const fresh = { id: 'bbbbbbbbbbbbbbbb', name: 'Webhook 2', createdAt: null, lastUsedAt: null };
  pg.PJS_HOOKS.list = [older, fresh];
  pg.PJS_HOOKS.reveal = { id: fresh.id, url: 'http://127.0.0.1:1/hooks/bbbbbbbbbbbbbbbb/SECRET' };
  answer = [older]; // the server answered before Webhook 2 was written
  await pg.pjsHooksOpen({ id: 'p' });
  assert.deepEqual(pg.PJS_HOOKS.list.map((h) => h.id), [older.id, fresh.id]);
  assert.ok(box.innerHTML.includes('SECRET'), 'its link is still on screen');
  pg.PJS_HOOKS.reveal = null;
  await pg.pjsHooksOpen({ id: 'p' });
  assert.deepEqual(pg.PJS_HOOKS.list.map((h) => h.id), [older.id], 'control: with no link showing, the read is taken as it is');
});
