'use strict';
/**
 * kosmos#4648 (weekend goal #4647): "Your computers" in the top-left Kosmos menu.
 * These run the SHIPPED computersRender / computersFetch from web/index.html against a
 * fake document (test-support/fake-dom), as web.world-import-agents-1704 does for the
 * Kosmos rows.
 *
 *   node --test web.computers-switcher-4648.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { makeDom } = require('./test-support/fake-dom');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
function constLine(name) {
  const at = PAGE.indexOf('const ' + name + ' = ');
  assert.ok(at >= 0, name + ' moved or renamed');
  return PAGE.slice(at, PAGE.indexOf('\n', at) + 1);
}
const RENDER = slice('computersRender');
const FETCH = slice('computersFetch');
const RE = slice('computerAddressOk');
const INAPP = slice('computersInApp') + slice('computersLinkTarget');   // #6406

function dom() {
  const d = makeDom();
  const box = d.add('worldsw-computers', 'div', { hidden: true });
  const list = d.add('worldsw-computers-list', 'div');
  return { d, box, list };
}
function render(data, visibleBefore, win) {
  const t = dom();
  if (visibleBefore) {
    // As a previous render left it: visible, holding a row, so both the hide AND the emptying are tested.
    t.box.hidden = false;
    t.list.appendChild(t.d.document.createElement('div'));
  }
  // eslint-disable-next-line no-new-func
  new Function('document', '_d', 'window', `${RE}${INAPP}${RENDER}\ncomputersRender(_d);`)(t.d.document, data, win || {});
  return t;
}
const LIST = {
  ok: true,
  domain: 'kosmosplus.com',
  computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true },
    { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true },
    { name: 'pizzarama', address: 'pizzarama.kosmosplus.com', this: false, online: false },
    { name: 'mortals', address: 'mortals.kosmosplus.com', this: false, online: true, updating: true },
  ],
};
const text = (row) => row.children.map((c) => c.textContent);

test('hidden when there is no list: not signed in ({ ok: false }), a failed read (null), only this computer, or no domain to check against', () => {
  for (const data of [{ ok: false, because: 'this computer is not signed in to Kosmos+' }, null, { ok: true, domain: 'kosmosplus.com', computers: [LIST.computers[0]] },
    { ok: true, computers: LIST.computers } /* no domain: nothing can be trusted */]) {
    // Starts VISIBLE, so this proves the render hides it (not that it began hidden).
    const { box, list } = render(data, true);
    assert.equal(box.hidden, true, JSON.stringify(data));
    assert.equal(list.children.length, 0, JSON.stringify(data));
  }
});

test('#6406: in the Kosmos app (Mac bridge, or Windows WebView2) an online computer opens in this window; in a browser, a new tab', () => {
  for (const [win, label] of [[{ webkit: { messageHandlers: { kosmosBadge: {} } } }, 'Mac app'], [{ chrome: { webview: {} } }, 'Windows app']]) {
    const a = render(LIST, false, win).list.children[1];
    assert.equal(a.href, 'https://agent1s.kosmosplus.com/', label);
    assert.ok(!a.target, label + ': no new window, so the app keeps it in its own window');
    assert.equal(a.rel, 'noopener noreferrer', label + ': this board\'s address never travels');
  }
  // CONTROL: a browser (no bridge) keeps the new tab.
  assert.equal(render(LIST, false, {}).list.children[1].target, '_blank');
});

test('#6406: every link the page builds to another computer goes through computersLinkTarget', () => {
  /* Any '_blank' set within six lines after a line that names a computer's address (c.address, or oaAgentHref) must be
     the helper's own fallback for a test that lifts one function; and each such href is followed by the helper. */
  const lines = PAGE.split('\n');
  const addressLine = (l) => /\.address\b|oaAgentHref\(/.test(l) && /href/.test(l);
  const sites = [];
  lines.forEach((l, i) => { if (addressLine(l)) sites.push(i); });
  assert.ok(sites.length >= 4, 'found ' + sites.length + ' address links');
  for (const i of sites) {
    const near = lines.slice(i, i + 7);
    assert.ok(near.some((l) => /computersLinkTarget\(/.test(l)), 'line ' + (i + 1) + ' must use the helper: ' + lines[i].trim());
    const bare = near.filter((l) => /target\s*=\s*['"]_blank['"]|setAttribute\(\s*['"]target['"]/.test(l) && !/typeof computersLinkTarget === 'function'/.test(l));
    assert.deepEqual(bare, [], 'line ' + (i + 1) + ' sets a new-window target by itself');
  }
});

test('this computer is marked and not a link; an ONLINE computer is a new-window link to its own address; offline and updating ones are plain rows that say so', () => {
  const { box, list } = render(LIST);
  assert.equal(box.hidden, false);
  assert.equal(list.children.length, 4);
  const [me, a, p, m] = list.children;
  assert.equal(me.tagName.toLowerCase(), 'div');
  assert.equal(me.getAttribute('aria-current'), 'true');
  assert.equal(me.href, undefined, 'this computer must not be a link away from itself');
  assert.deepEqual(text(me).slice(1), ['laptop', 'This computer']);
  // Online: a link, in a new window.
  assert.equal(a.tagName.toLowerCase(), 'a');
  assert.equal(a.href, 'https://agent1s.kosmosplus.com/');
  assert.equal(a.target, '_blank', 'opening must not replace this computer');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.deepEqual(text(a).slice(1), ['agent1s', 'Online']);
  assert.equal(a.getAttribute('aria-label'), 'Open agent1s, online');
  // Not connected and Updating: plain rows (a link would open a browser error page).
  for (const [row, name, state] of [[p, 'pizzarama', 'Not connected'], [m, 'mortals', 'Updating']]) {
    assert.equal(row.tagName.toLowerCase(), 'div', name + ' must not be a link while ' + state);
    assert.equal(row.href, undefined, name);
    assert.deepEqual(text(row).slice(1), [name, state], name);
    assert.ok(row.className.split(' ').includes('worldsw-row-off'), name);
  }
});

test('a row whose address is not one label under the domain (another host, a LAN address, punycode, a URL) is dropped; a name is text, never markup', () => {
  const { list } = render({ ok: true, domain: 'kosmosplus.com', computers: [
    LIST.computers[0],
    { name: 'lan', address: '10.0.0.1', online: true },
    { name: 'elsewhere', address: 'evil.example', online: true },
    { name: 'punycode', address: 'xn--pple-43d.kosmosplus.com', online: true },
    { name: 'evil', address: 'javascript:alert(1)', online: true },
    { name: 'evil2', address: 'x.kosmosplus.com/../@evil.example', online: true },
    { name: '<img src=x onerror=alert(1)>', address: 'odd.kosmosplus.com', online: true },
  ] });
  const names = list.children.map((r) => r.children[1].textContent);
  assert.deepEqual(names, ['laptop', '<img src=x onerror=alert(1)>'], 'only valid addresses become rows');
  assert.equal(list.children[1].href, 'https://odd.kosmosplus.com/');
  assert.equal(list.children[1].children[1].children.length, 0, 'the name was parsed as markup');
});

test('a slow read from an EARLIER open does not repaint over a newer one', async () => {
  const t = dom();
  const resolvers = [];
  const fetchFn = () => new Promise((r) => resolvers.push(r));
  const answer = (data) => ({ ok: true, json: async () => data });
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', `${RE}let COMPUTERS_GEN = 0;\n${RENDER}\n${FETCH}\nreturn { computersFetch };`)(t.d.document, fetchFn);
  t.box.hidden = false; // as left by an earlier open
  const first = api.computersFetch();
  assert.equal(t.box.hidden, true, 'last time\'s list stayed visible while a fresh read was in flight');
  const second = api.computersFetch();
  // The newer read lands first, then the older one arrives late with a different list.
  resolvers[1](answer(LIST));
  await second;
  resolvers[0](answer({ ok: false, because: 'stale' }));
  await first;
  assert.equal(t.box.hidden, false, 'the late, older answer hid the section');
  assert.equal(t.list.children.length, 4);
});

test('opening the menu reads the computers fresh: the shipped worldswOpen CALLS computersFetch (run, not grepped)', () => {
  const d = makeDom();
  d.add('worldsw-menu', 'div', { hidden: true });
  d.add('worldsw-btn', 'button');
  let calls = 0;
  // eslint-disable-next-line no-new-func
  new Function('document', 'computersFetch', `${slice('worldswOpen')}\nworldswOpen();`)(d.document, () => { calls++; return Promise.resolve(); });
  assert.equal(calls, 1, 'opening the menu did not read the computers');
});

/* kosmos#6406 step 2: a plain click on a link to another computer, in the app, asks this computer for a ticket and opens
   the other computer with it in the fragment; anything else keeps the plain address. */
const OPEN = slice('computersInApp') + slice('computersGo') + slice('computersOpenClick');
const DECL = (() => { const at = PAGE.indexOf('let computersOpening = '); assert.ok(at >= 0, 'computersOpening moved'); return PAGE.slice(at, PAGE.indexOf('\n', at) + 1); })();   // the page's own declaration, not a copy
function clickWith({ win, answer, ev, href, twice, timers, linkAttrs }) {
  const went = [];
  const posted = [];
  const attrs = Object.assign({}, linkAttrs || {});
  const screens = [];
  const toasts = [];
  const a = { href: href || 'https://tmnt.kosmosplus.com/?tab=detail&agent=x', closest: (sel) => (sel === 'a[data-computer-open]' ? a : null),
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, getAttribute: (k) => (k in attrs ? attrs[k] : null) };
  const e = Object.assign({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: a,
    preventDefault() { this.defaultPrevented = true; } }, ev || {});
  const assigned = [];
  const w = Object.assign({ location: { assign: (u) => assigned.push(u) } }, win || {});
  // A page: the navigation the app takes goes through a throwaway link (computersGo); its click is the navigation.
  const doc = { createElement: () => ({ setAttribute() {}, click() { went.push(this.href + (this.rel === 'noreferrer' ? '' : ' (REFERER)')); }, remove() {} }),
    body: { appendChild() {} } };
  const fetchFn = (url, opts) => { posted.push({ url, body: JSON.parse(opts.body) }); return answer(); };
  const second = Object.assign({}, e, { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  // #6585: the switching screen and the toast are recorded, not drawn (the screen has its own test below).
  const run = new Function('window', 'document', 'fetch', 'e', 'second', 'twice', 'URL', 'AbortController', 'setTimeout', 'clearTimeout',
    'computersSwitchingScreen', 'msgToast',
    `${DECL}\n${OPEN}\ncomputersOpenClick(e);\nif (twice) computersOpenClick(second);`);
  run(w, doc, fetchFn, e, second, !!twice, URL, AbortController, timers ? timers.set : setTimeout, timers ? timers.clear : clearTimeout,
    (n) => screens.push(n), (m) => toasts.push(m));
  // went: navigations through the noreferrer link; assigned: script navigations (which would send a Referer), never.
  assert.deepEqual(assigned, [], 'no script navigation');
  return { went, posted, e, attrs, screens, toasts };
}
const APP = { webkit: { messageHandlers: { kosmosBadge: {} } } };
const settle = () => new Promise((r) => setTimeout(r, 20));

test('#6406 step 2: in the app a plain click opens the other computer with a ticket, keeping its path', async () => {
  const t = clickWith({ win: APP, answer: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ticket: 'abcdefghijklmnopqrstuvwxyz_-0123' }) }) });
  await settle();
  assert.ok(t.e.defaultPrevented);
  assert.deepEqual(t.posted, [{ url: '/api/remote/open-ticket', body: { address: 'tmnt.kosmosplus.com' } }]);
  assert.deepEqual(t.went, ['https://tmnt.kosmosplus.com/?tab=detail&agent=x#kpt=abcdefghijklmnopqrstuvwxyz_-0123']);
});

test('#6406 step 2: a refused or failed ticket, or one of the wrong shape, opens the plain address', async () => {
  for (const [label, answer] of [
    ['refused', () => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'x' }) })],
    ['unreachable', () => Promise.reject(new Error('down'))],
    ['odd ticket', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ticket: 'not one <b>' }) })],
  ]) {
    const t = clickWith({ win: APP, answer });
    await settle();
    assert.deepEqual(t.went, ['https://tmnt.kosmosplus.com/?tab=detail&agent=x'], label);
  }
});

test('#6406 step 2: a browser, or a modified click, keeps the plain link and asks for nothing', async () => {
  const never = () => { throw new Error('asked for a ticket'); };
  for (const [label, win, ev] of [
    ['browser', {}, {}], ['cmd-click', APP, { metaKey: true }], ['ctrl-click', APP, { ctrlKey: true }],
    ['shift-click', APP, { shiftKey: true }], ['middle', APP, { button: 1 }], ['already handled', APP, { defaultPrevented: true }],
  ]) {
    const t = clickWith({ win, answer: never, ev });
    await settle();
    assert.equal(t.posted.length, 0, label);
    assert.equal(t.went.length, 0, label);
    if (label !== 'already handled') assert.ok(!t.e.defaultPrevented, label + ': the link does its own thing');
  }
  // Not https (a mistake in a row): nothing is taken over.
  const t = clickWith({ win: APP, answer: never, href: 'http://tmnt.kosmosplus.com/' });
  assert.ok(!t.e.defaultPrevented);
});

test('#6406 step 2: every link to another computer is marked for the click', () => {
  const attrs = {};
  const a = { setAttribute: (k, v) => { attrs[k] = v; } };
  new Function('window', 'a', `${INAPP}\ncomputersLinkTarget(a);`)(APP, a);
  assert.equal(attrs['data-computer-open'], '1');
});

test('#6406 step 2: one ticket at a time (a second click while the first is out does nothing more), and the link says it is busy', async () => {
  let resolve;
  const t = clickWith({ win: APP, twice: true, answer: () => new Promise((r) => { resolve = r; }) });
  assert.equal(t.posted.length, 1, 'one request for two clicks');
  assert.equal(t.attrs['aria-busy'], 'true', 'busy while the ticket is made');
  resolve({ ok: true, json: () => Promise.resolve({ ticket: 'abcdefghijklmnopqrstuvwxyz_-0123' }) });
  await settle();
  assert.equal(t.went.length, 1);
  assert.equal(t.attrs['aria-busy'], undefined, 'busy is cleared');
});

test('#6406 step 2: a ticket request that never answers opens the plain address after 8 s, once, and clears busy', async () => {
  const pending = [];
  const timers = { set: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clear: () => {} };
  let resolve;
  const t = clickWith({ win: APP, timers, answer: () => new Promise((r) => { resolve = r; }) });
  assert.equal(t.went.length, 0, 'nothing yet');
  const cut = pending.find((p) => p.ms === 8000);
  assert.ok(cut, 'an 8 s fallback is set: ' + JSON.stringify(pending.map((p) => p.ms)));
  cut.fn();
  assert.deepEqual(t.went, ['https://tmnt.kosmosplus.com/?tab=detail&agent=x']);
  assert.equal(t.attrs['aria-busy'], undefined);
  // The answer arriving late changes nothing (one navigation only).
  resolve({ ok: true, json: () => Promise.resolve({ ticket: 'abcdefghijklmnopqrstuvwxyz_-0123' }) });
  await settle();
  assert.equal(t.went.length, 1);
});

/* kosmos#6585 (Josh 2026-10-19 09:12: "it immediately switches ... our animated K with the dots, that's fine too"). */
test('#6585: a switch shows the switching screen with the computer\'s name at the click, before the ticket answers', async () => {
  let resolve;
  const t = clickWith({ win: APP, linkAttrs: { 'data-computer-name': 'tmnt' }, answer: () => new Promise((r) => { resolve = r; }) });
  assert.deepEqual(t.screens, ['tmnt'], 'the screen is up while the ticket is made, not after');
  assert.equal(t.went.length, 0);
  resolve({ ok: true, json: () => Promise.resolve({ ticket: 'abcdefghijklmnopqrstuvwxyz_-0123' }) });
  await settle();
  assert.equal(t.went.length, 1);
  assert.deepEqual(t.screens, ['tmnt'], 'once');
  // No name on the link (a copy from before this change): the address's first label stands in.
  assert.deepEqual(clickWith({ win: APP, answer: () => new Promise(() => {}) }).screens, ['tmnt']);
});

test('#6585: a computer measured as unable to take the instant switch says so and stays: no ticket, no navigation, no screen', async () => {
  const never = () => { throw new Error('asked for a ticket'); };
  const t = clickWith({ win: APP, answer: never, linkAttrs: { 'data-computer-name': 'tmnt', 'data-computer-instant': '0' } });
  await settle();
  assert.ok(t.e.defaultPrevented, 'the sign-in page must not open');
  assert.deepEqual(t.posted, []);
  assert.deepEqual(t.went, []);
  assert.deepEqual(t.screens, []);
  assert.equal(t.toasts.length, 1);
  assert.match(t.toasts[0], /^tmnt is on an older Kosmos, so it cannot switch instantly yet\. Update Kosmos on tmnt, or open tmnt\.kosmosplus\.com in your browser and sign in\.$/);
  // Not one at a time: a refusal never holds the next click.
  assert.equal(t.attrs['aria-busy'], undefined);
});

test('#6585: an online row carries its name, and "0" only when the board measured instant: false; the phone menu copies both', () => {
  const data = { ok: true, domain: 'kosmosplus.com', computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true },
    { name: 'tmnt', address: 'tmnt.kosmosplus.com', this: false, online: true, instant: false },
    { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true, instant: true },
    { name: 'mortals', address: 'mortals.kosmosplus.com', this: false, online: true },
  ] };
  const t = render(data, false, APP);
  const rows = Array.from(t.list.children).filter((r) => r.tagName === 'A');
  const by = Object.fromEntries(rows.map((r) => [r.getAttribute('data-computer-name'), r]));
  assert.deepEqual(Object.keys(by).sort(), ['agent1s', 'mortals', 'tmnt']);
  assert.equal(by.tmnt.getAttribute('data-computer-instant'), '0');
  assert.equal(by.agent1s.getAttribute('data-computer-instant') == null, true, 'instant: true opens as before');
  assert.equal(by.mortals.getAttribute('data-computer-instant') == null, true, 'not measured: try the ticket as before');
  // The phone menu's copy (pnavFill) carries both attributes over.
  const src = slice('pnavFill');
  assert.match(src, /for \(const k of \['data-computer-name', 'data-computer-instant'\]\) \{ if \(row\.hasAttribute\(k\)\) it\.setAttribute\(k, row\.getAttribute\(k\)\); \}/);
});

test('#6406 step 2: on a page, the navigation goes through a throwaway hidden noreferrer link that is not marked', async () => {
  const made = [];
  const doc = { createElement: (tag) => { const el = { tag, attrs: {}, clicked: 0, removed: false,
    click() { this.clicked += 1; }, remove() { this.removed = true; } }; made.push(el); return el; },
    body: { appendChild: (el) => { el.inPage = true; } } };
  let assigned = null;
  const w = { location: { assign: (u) => { assigned = u; } } };
  new Function('window', 'document', `${slice('computersGo')}\ncomputersGo('https://tmnt.kosmosplus.com/#kpt=x');`)(w, doc);
  assert.equal(made.length, 1);
  const l = made[0];
  assert.deepEqual([l.tag, l.href, l.rel, l.hidden, l.inPage, l.clicked, l.removed], ['a', 'https://tmnt.kosmosplus.com/#kpt=x', 'noreferrer', true, true, 1, true]);
  assert.equal(l.attrs['data-computer-open'], undefined, 'not marked, so computersOpenClick leaves it alone');
  assert.equal(assigned, null, 'no script navigation (it would send a Referer)');
});

