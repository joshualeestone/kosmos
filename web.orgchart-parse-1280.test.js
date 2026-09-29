'use strict';

/**
 * #1280: the org-chart import's pure parse/slug/de-dup logic, executed directly
 * out of web/index.html (the same extract-and-eval discipline as
 * web.account-name-2095.test.js / web.acct-picker-1917.test.js). The browser-check
 * render-orgchart-import-1280.js proves the rendered flow end to end; this is the
 * fast, isolated guard on the tricky logic underneath it: the earliest-delimiter
 * split, title-derived slugs, and the de-dup loop that HAD a real infinite-loop
 * hazard (a suffix sliced back off a max-length base), so termination on many
 * identical long titles is asserted rather than assumed.
 *
 *   node --test web.orgchart-parse-1280.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

// parseOrgchart calls orgchartSlug and reads ORGCHART_NAME_MAX (via its inner
// uniq); extract the real const line so the test uses the SAME cap as the source
// and cannot silently drift from it.
const capLine = PAGE.match(/const ORGCHART_NAME_MAX = \d+;/);
assert.ok(capLine, 'ORGCHART_NAME_MAX const is gone from the page');
const NAME_MAX = Number(capLine[0].match(/\d+/)[0]);

const fns = new Function(`
  ${capLine[0]}
  ${grab('function orgchartSlug(')}
  ${grab('function parseOrgchart(')}
  ${grab('function orgchartRows(')}
  return { orgchartSlug, parseOrgchart, orgchartRows, ORGCHART_NAME_MAX };
`)();
const { orgchartSlug, parseOrgchart, orgchartRows } = fns;

test('#1280: a title-only line becomes one member, named from the title, no person', () => {
  const rows = parseOrgchart('Marketing Lead', false);
  assert.equal(rows.length, 1);
  // #4559 added the reporting fields; a pasted line reports to the person (null) and needs no look.
  assert.deepEqual(rows[0], { name: 'marketing-lead', role: 'own', label: 'Marketing Lead', person: '', from: '', reportsTo: null, why: null, confirmed: false });
});

test('#1280: a comma line splits into name, title', () => {
  const rows = parseOrgchart('Sarah Chen, Head of Sales', false);
  assert.equal(rows[0].label, 'Head of Sales');
  // Names off by default: the person is dropped and the agent is named for the title.
  assert.equal(rows[0].name, 'head-of-sales');
  assert.equal(rows[0].person, '');
});

test('#1280: names opt-in uses the person for the machine name and keeps the title as label', () => {
  const rows = parseOrgchart('Sarah Chen, Head of Sales', true);
  assert.equal(rows[0].name, 'sarah-chen');
  assert.equal(rows[0].label, 'Head of Sales');
  assert.equal(rows[0].person, 'Sarah Chen');
});

test('#1280: opting into names still falls back to the title when a row has no name', () => {
  const rows = parseOrgchart('Marketing Lead', true);
  assert.equal(rows[0].name, 'marketing-lead');
  assert.equal(rows[0].person, '');
});

test('#1280: the split is on the EARLIEST separator, so a tab wins over a later comma', () => {
  // A two-column spreadsheet paste whose title carries a comma must split at the tab.
  const rows = parseOrgchart('Sarah\tSuccess Manager, EMEA', true);
  assert.equal(rows[0].person, 'Sarah');
  assert.equal(rows[0].label, 'Success Manager, EMEA');
});

test('#1280: blank and whitespace-only lines are skipped', () => {
  const rows = parseOrgchart('Engineer\n\n   \n\tDesigner', false);
  // Line 1 "Engineer"; line 4 "\tDesigner" splits at the leading tab into an empty
  // name and title "Designer" (the empty-name path keeps the title).
  assert.deepEqual(rows.map((r) => r.label), ['Engineer', 'Designer']);
});

test('#1280: duplicate titles de-duplicate to distinct names, second suffixed -2', () => {
  const rows = parseOrgchart('Engineer\nEngineer\nEngineer', false);
  assert.deepEqual(rows.map((r) => r.name), ['engineer', 'engineer-2', 'engineer-3']);
});

test('#1280: many identical LONG titles terminate and stay within the cap (the hang guard)', () => {
  // The regression this pins: a >=cap-length base with the numeric suffix sliced
  // back off reproduced the base, so `while (used[s])` never cleared and the tab
  // hung. If that returned, THIS test would hang; a returned array is the proof.
  const long = 'Senior Site Reliability Engineering Manager'; // slug exceeds the cap
  const rows = parseOrgchart(Array(12).fill(long).join('\n'), false);
  assert.equal(rows.length, 12);
  const names = rows.map((r) => r.name);
  assert.equal(new Set(names).size, 12, 'all 12 derived names are distinct');
  for (const n of names) assert.ok(n.length <= NAME_MAX, n + ' exceeds the ' + NAME_MAX + '-char cap');
});

test('#1280: orgchartSlug lowercases, hyphenates, trims, and caps at the max', () => {
  assert.equal(orgchartSlug('Marketing Lead'), 'marketing-lead');
  assert.equal(orgchartSlug('  VP,  Product & Ops!  '), 'vp-product-ops');
  assert.ok(orgchartSlug('x'.repeat(80)).length <= NAME_MAX);
});

test('#1280: a punctuation-only title still yields a candidate the engine can rule on', () => {
  assert.equal(orgchartSlug('***'), 'agent');
  const rows = parseOrgchart('***', false);
  assert.equal(rows[0].name, 'agent');
  assert.equal(rows[0].label, '***');
});

test('#1280 CONTROL: the parse can actually FAIL its assertions (a wrong split is visible)', () => {
  // Guards against a vacuous suite: if the split were comma-always (the pre-fix
  // bug), this tab line would mis-split and person would be the whole "Sarah\t..." run.
  const rows = parseOrgchart('Sarah\tSuccess Manager, EMEA', true);
  assert.notEqual(rows[0].person, 'Sarah\tSuccess Manager', 'a comma-always split would produce this');
});

test('#4559: file rows keep their reporting lines and reasons, re-pointed past a row with no title', () => {
  const rows = orgchartRows([
    { person: 'Avery Quill', title: 'Chief Executive', reportsTo: null, why: null },
    { person: 'Nobody', title: '', reportsTo: null, why: null },   // skipped: no title
    { person: 'Bo Linden', title: 'Head of Sales', reportsTo: 0, why: null },
    { person: 'Cy Marsh', title: 'Sales Rep', reportsTo: 2, why: 'the line is unclear' },
  ], false, 'file');
  assert.deepEqual(rows.map((r) => [r.label, r.reportsTo, r.why, r.from, r.person]), [
    ['Chief Executive', null, null, 'Avery Quill', ''],
    ['Head of Sales', 0, null, 'Bo Linden', ''],
    ['Sales Rep', 1, 'the line is unclear', 'Cy Marsh', ''],
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['chief-executive', 'head-of-sales', 'sales-rep'], 'names off: agents are named for the title, not the person');
  const named = orgchartRows([{ person: 'Avery Quill', title: 'Chief Executive', reportsTo: null }], true, 'file');
  assert.equal(named[0].name, 'avery-quill');
});

test('#4559: the page and the engine agree on which files go to the model', () => {
  const m = /const ORGCHART_MODEL_FILE = \/\\\.\(([^)]+)\)\$\/i;/.exec(PAGE);
  assert.ok(m, 'ORGCHART_MODEL_FILE is gone from the page');
  const exts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'csv', 'xlsx', 'svg', 'pptx'];
  const page = new RegExp('\\.(' + m[1] + ')$', 'i');
  const { forModel } = require('./engine/orgchartfile');
  for (const e of exts) assert.equal(page.test('x.' + e), forModel('x.' + e), '.' + e + ' is treated differently by the page and the engine');
});

test('#4559: the page refuses a file over the same size the board reads', () => {
  const m = /const ORGCHART_MAX_BYTES = ([^;]+);/.exec(PAGE);
  assert.ok(m, 'ORGCHART_MAX_BYTES is gone from the page');
  const page = Function('return (' + m[1] + ')')();
  assert.ok(Number.isInteger(page) && page > 0, 'CONTROL: read as a number: ' + page);
  assert.equal(page, require('./engine/orgchartfile').MAX_BYTES);
});

test('#4559: the page refuses a chart past the same number of agents one create can make', () => {
  const m = /const ORGCHART_TEAM_MAX = (\d+);/.exec(PAGE);
  assert.ok(m, 'ORGCHART_TEAM_MAX is gone from the page');
  assert.equal(Number(m[1]), require('./engine/team').MAX_TEAM_CAP);
});

test('#4559: the page asks before more than the usual team size, the same size the engine uses', () => {
  const m = /const ORGCHART_TEAM_DEFAULT = (\d+);/.exec(PAGE);
  assert.ok(m, 'ORGCHART_TEAM_DEFAULT is gone from the page');
  assert.equal(Number(m[1]), require('./engine/team').DEFAULT_TEAM_CAP);
});
