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
const RE = constLine('COMPUTER_ADDRESS_RE');

function dom() {
  const d = makeDom();
  const box = d.add('worldsw-computers', 'div', { hidden: true });
  const list = d.add('worldsw-computers-list', 'div');
  return { d, box, list };
}
function render(data) {
  const t = dom();
  // eslint-disable-next-line no-new-func
  new Function('document', '_d', `${RE}${RENDER}\ncomputersRender(_d);`)(t.d.document, data);
  return t;
}
const LIST = {
  ok: true,
  computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true },
    { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true },
    { name: 'pizzarama', address: 'pizzarama.kosmosplus.com', this: false, online: false },
    { name: 'mortals', address: 'mortals.kosmosplus.com', this: false, online: true, updating: true },
  ],
};
const text = (row) => row.children.map((c) => c.textContent);

test('hidden when there is no list: not signed in ({ ok: false }), a failed read (null), or only this computer', () => {
  for (const data of [{ ok: false, because: 'this computer is not signed in to Kosmos+' }, null, { ok: true, computers: [LIST.computers[0]] }]) {
    const { box, list } = render(data);
    assert.equal(box.hidden, true, JSON.stringify(data));
    assert.equal(list.children.length, 0, JSON.stringify(data));
  }
});

test('this computer is marked and not a link; every other computer is a link to its own address, in a new window, with its state in words', () => {
  const { box, list } = render(LIST);
  assert.equal(box.hidden, false);
  assert.equal(list.children.length, 4);
  const [me, a, p, m] = list.children;
  assert.equal(me.tagName.toLowerCase(), 'div');
  assert.equal(me.getAttribute('aria-current'), 'true');
  assert.equal(me.href, undefined, 'this computer must not be a link away from itself');
  assert.deepEqual(text(me).slice(1), ['laptop', 'This computer']);
  for (const [row, name, state] of [[a, 'agent1s', 'Online'], [p, 'pizzarama', 'Not connected'], [m, 'mortals', 'Updating']]) {
    assert.equal(row.tagName.toLowerCase(), 'a', name);
    assert.equal(row.href, 'https://' + name + '.kosmosplus.com/', name);
    assert.equal(row.target, '_blank', name + ': opening must not replace this computer');
    assert.equal(row.rel, 'noopener noreferrer', name);
    assert.deepEqual(text(row).slice(1), [name, state], name);
    assert.equal(row.getAttribute('aria-label'), 'Open ' + name + ', ' + state.toLowerCase());
  }
});

test('a row whose address is not a plain DNS name is dropped, never turned into a link; a name is text, never markup', () => {
  const { list } = render({ ok: true, computers: [
    LIST.computers[0],
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
  const first = api.computersFetch();
  const second = api.computersFetch();
  // The newer read lands first, then the older one arrives late with a different list.
  resolvers[1](answer(LIST));
  await second;
  resolvers[0](answer({ ok: false, because: 'stale' }));
  await first;
  assert.equal(t.box.hidden, false, 'the late, older answer hid the section');
  assert.equal(t.list.children.length, 4);
});

test('opening the menu reads the computers fresh (worldswOpen calls computersFetch)', () => {
  const open = slice('worldswOpen');
  assert.match(open, /computersFetch\(\)/);
});
