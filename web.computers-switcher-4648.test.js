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

function dom() {
  const d = makeDom();
  const box = d.add('worldsw-computers', 'div', { hidden: true });
  const list = d.add('worldsw-computers-list', 'div');
  return { d, box, list };
}
function render(data, visibleBefore) {
  const t = dom();
  if (visibleBefore) {
    // As a previous render left it: visible, holding a row, so both the hide AND the emptying are tested.
    t.box.hidden = false;
    t.list.appendChild(t.d.document.createElement('div'));
  }
  // eslint-disable-next-line no-new-func
  new Function('document', '_d', `${RE}${RENDER}\ncomputersRender(_d);`)(t.d.document, data);
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

test('#4726 a computer still waiting to be allowed is a greyed row that says so, never a link, even when it reads online; an allowed one is a link (control)', () => {
  const data = { ok: true, domain: 'kosmosplus.com', computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true, held: false },
    { name: 'planted', address: 'planted.kosmosplus.com', this: false, online: true, held: true },
    { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true, held: false },
  ] };
  const { list } = render(data);
  const [, held, allowed] = list.children;
  assert.equal(held.tagName.toLowerCase(), 'div', 'a held computer must never be a link');
  assert.equal(held.href, undefined);
  assert.deepEqual(text(held).slice(1), ['planted', 'Waiting to be allowed']);
  assert.equal(held.title, 'Waiting to be allowed from another of your computers', 'the whole sentence is the row title');
  assert.ok(held.className.split(' ').includes('worldsw-row-off'), 'a held computer is greyed');
  assert.equal(allowed.tagName.toLowerCase(), 'a', 'CONTROL: an allowed online computer is still a link');
  assert.deepEqual(text(allowed).slice(1), ['agent1s', 'Online']);
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
