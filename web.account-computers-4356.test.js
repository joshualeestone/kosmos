'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDom } = require('./test-support/fake-dom');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function slice(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
const RENDER = slice('worldswRender');

function render(accountRows) {
  const dom = makeDom();
  dom.add('worldsw', 'div', { hidden: true });
  dom.add('worldsw-name', 'span');
  const list = dom.add('worldsw-list');
  dom.add('worldsw-btn', 'button');
  const window = { location: { href: 'http://127.0.0.1:16180/' } };
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'ACCOUNT_COMPUTERS', 'worldswConfirmSwitch', 'worldRenameOpen', 'worldswSetStale', '_d', `${RENDER}\nworldswRender(_d);`)(
    dom.document, window, accountRows, () => {}, () => {}, () => {},
    { worlds: [{ id: 'default', name: 'Kosmos 1' }, { id: 'two', name: 'Kosmos 2' }], activeWorldId: 'default' },
  );
  return { dom, list, window };
}

test('the computer menu keeps local Kosmoses nested and puts account computers below them', () => {
  const { dom, list } = render([
    { name: 'My laptop', address: 'mine.kosmosplus.com', online: true, thisComputer: true, openUrl: null },
    { name: 'Mortals', address: 'mortals.kosmosplus.com', online: true, thisComputer: false, openUrl: 'https://login.kosmosplus.com/signin?open=mortals.kosmosplus.com' },
    { name: 'Office', address: 'office.kosmosplus.com', online: false, thisComputer: false, openUrl: null },
  ]);
  assert.equal(dom.document.getElementById('worldsw-name').textContent, 'My laptop');
  assert.equal(list.children[0].textContent, 'This computer · My laptop');
  assert.equal(list.children[1].className, 'worldsw-local');
  assert.equal(list.children[1].children.length, 2, 'same-Mac instances disappeared');
  assert.equal(list.children[2].children[1].textContent, 'Mortals');
  assert.equal(list.children[2].disabled, false);
  assert.equal(list.children[3].children[1].textContent, 'Office');
  assert.equal(list.children[3].children[2].textContent, 'Offline');
  assert.equal(list.children[3].disabled, true);
});

test('an online computer opens only its server-validated short-handoff intent', () => {
  const target = 'https://login.kosmosplus.com/signin?open=mortals.kosmosplus.com';
  const { list, window } = render([
    { name: 'My laptop', address: 'mine.kosmosplus.com', online: true, thisComputer: true, openUrl: null },
    { name: 'Mortals', address: 'mortals.kosmosplus.com', online: true, thisComputer: false, openUrl: target },
  ]);
  list.children[2].click();
  assert.equal(window.location.href, target);
  assert.doesNotMatch(window.location.href, /kst=|token=/, 'a durable credential entered the URL');
});

test('without a signed account answer the local instances still render', () => {
  const { list } = render([]);
  assert.equal(list.children[0].textContent, 'This computer');
  assert.equal(list.children[1].children.length, 2);
  assert.equal(list.children.length, 2, 'a remote computer was guessed');
});
