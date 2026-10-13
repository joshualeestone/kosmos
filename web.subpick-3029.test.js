'use strict';
/* #3029: the chain helpers every project picker and the Tasks screen use, run as shipped in web/index.html.
 *
 *   node --test web.subpick-3029.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const make = (projects) => new Function('PROJECTS',
  'const pjById = (id) => PROJECTS.find((p) => p && p.id === id) || null;\n'
  + page.liftAll(SCRIPT, ['pjAncestry', 'pjChainOf', 'pjChainCompare', 'pjChainText', 'pjSortByChain', 'tskChainOf'])
  + '\nreturn { pjChainOf, pjChainCompare, pjChainText, pjSortByChain, tskChainOf };')(projects);

const mk = (id, name, parent) => ({ id, name, parent: parent || null });
const PROJECTS = [mk('al2', 'Alpha - old'), mk('bb', 'Book B'), mk('als', 'Sub', 'al'), mk('ba', 'Book A'),
  mk('lb', 'Launch', 'bb'), mk('al', 'Alpha'), mk('la', 'Launch', 'ba'), mk('ad', 'Ads', 'la')];

test('ordered by chain segment by segment: each subproject follows its parent, Alpha - old after Alpha and its child', () => {
  const F = make(PROJECTS);
  const order = PROJECTS.slice().sort((a, b) => F.pjChainCompare(F.pjChainOf(a), F.pjChainOf(b))).map((p) => F.pjChainText(F.pjChainOf(p)));
  assert.deepEqual(order, ['Alpha', 'Alpha › Sub', 'Alpha - old', 'Book A', 'Book A › Launch', 'Book A › Launch › Ads', 'Book B', 'Book B › Launch']);
  // CONTROL: the joined-string sort this rejects does put Alpha - old between Alpha and its child, so the order above can fail.
  const joined = PROJECTS.map((p) => F.pjChainText(F.pjChainOf(p))).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(joined.slice(0, 3), ['Alpha', 'Alpha - old', 'Alpha › Sub']);
});

test('a top-level project reads as its bare name; a prefix sorts before its own children', () => {
  const F = make(PROJECTS);
  assert.equal(F.pjChainText(F.pjChainOf(PROJECTS.find((p) => p.id === 'ba'))), 'Book A');
  assert.ok(F.pjChainCompare(['Book A'], ['Book A', 'Launch']) < 0);
  assert.equal(F.pjChainCompare(['Book A', 'Launch'], ['Book A', 'Launch']), 0);
});

test('tskChainOf reads a Tasks row: its projectPath then its own name, and a row with no path is just the name', () => {
  const F = make([]);
  assert.deepEqual(F.tskChainOf({ projectName: 'Ads', projectPath: ['Book A', 'Launch'] }), ['Book A', 'Launch', 'Ads']);
  assert.deepEqual(F.tskChainOf({ projectName: 'Solo' }), ['Solo']);
});

test('pjSortByChain gives the same order as the comparator, without touching the list it is handed', () => {
  const F = make(PROJECTS);
  const before = PROJECTS.map((p) => p.id).join();
  const sorted = F.pjSortByChain(PROJECTS).map((p) => F.pjChainText(F.pjChainOf(p)));
  assert.deepEqual(sorted, ['Alpha', 'Alpha › Sub', 'Alpha - old', 'Book A', 'Book A › Launch', 'Book A › Launch › Ads', 'Book B', 'Book B › Launch']);
  assert.equal(PROJECTS.map((p) => p.id).join(), before, 'the shared list must not be reordered');
});

test('tskChainOf on a row with no project name gives an empty name, never the text undefined', () => {
  const F = make([]);
  assert.deepEqual(F.tskChainOf({ projectPath: ['Book A'] }), ['Book A', '']);
});
