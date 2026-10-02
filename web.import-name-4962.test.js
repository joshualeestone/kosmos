'use strict';
/**
 * kosmos#4962 (split from #2419/#2461): a found agent file that does not say what to call the agent gets a
 * Name field on its row, so it can be added right there instead of sending the person to the create form.
 * These run the SHIPPED foundImportRowsHtml and addImportedInPlace from web/index.html against a fake row
 * and a fake fetch (no agent is made: the create request is answered by the fake).
 *
 *   node --test web.import-name-4962.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDom } = require('./test-support/fake-dom');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cssId = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '-').slice(-60);
// eslint-disable-next-line no-new-func
const foundImportRowsHtml = new Function('esc', 'cssId', slice('foundImportRowsHtml') + '\nreturn foundImportRowsHtml;')(esc, cssId);

test('a nameless row carries a labelled Name field with its helper; a named row has none', () => {
  const html = foundImportRowsHtml([
    { file: '/Users/p/Downloads/pip.md', name: '' },
    { file: '/Users/p/Downloads/don.md', name: 'Don' },
  ]);
  const rows = html.split('<div class="fr-importrow"').slice(1);
  assert.equal(rows.length, 2);
  const m = /<input class="tk-inp fr-importinput" id="([^"]+)"/.exec(rows[0]);
  assert.ok(m, 'the nameless row has a Name field');
  assert.match(rows[0], new RegExp('<label class="fr-importlab" for="' + m[1] + '">Name</label>'), 'the field has a label tied to it');
  assert.match(rows[0], new RegExp('aria-describedby="' + m[1] + '-help"'), 'the helper describes the field');
  assert.match(rows[0], /What should we call it\? You can rename it anytime\./);
  assert.doesNotMatch(rows[1], /fr-importinput/, 'control: a row with a name asks for nothing');
});

test('two nameless files whose paths share the last 60 characters still get distinct field ids', () => {
  const tail = '/' + 'x'.repeat(70) + '.md';
  const html = foundImportRowsHtml([{ file: '/a' + tail, name: '' }, { file: '/b' + tail, name: '' }]);
  const ids = [...html.matchAll(/class="tk-inp fr-importinput" id="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

/* A row as the page builds it, in the fake DOM, plus a fetch that answers the parse and the create. */
function rig({ withField, parsed, created }) {
  const t = makeDom();
  const row = t.create('div'); row.className = 'fr-importrow';
  const cls = () => ({ add(c) { this.el.className += ' ' + c; } });
  row.classList = Object.assign(cls(), { el: row });
  let field = null;
  if (withField) { field = t.create('input'); field.className = 'tk-inp fr-importinput'; row.appendChild(field); }
  const btn = t.create('button'); btn.className = 'btn uprime fr-importgo'; btn.textContent = 'Add to Kosmos';
  btn.classList = Object.assign(cls(), { el: btn });
  const said = t.create('p'); said.className = 'fr-importsaid';
  row.append(btn, said);
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const answer = calls.length === 1 ? parsed : created;
    return { ok: answer.httpOk !== false, json: async () => answer };
  };
  // eslint-disable-next-line no-new-func
  const add = new Function('document', 'fetch', slice('addImportedInPlace') + '\nreturn addImportedInPlace;')(t.document, fetchImpl);
  return { add, row, btn, field, said, calls, d: t };
}
const PARSED_NAMELESS = { ok: true, name: '', displayName: '', instructions: 'You help with the site.', provider: 'anthropic' };
const CREATED = { ok: true, outcome: 'created' };

test('an empty Name field asks for a name, sends nothing, and puts the cursor in the field', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS, created: CREATED });
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.equal(r.calls.length, 0, 'nothing was sent');
  assert.equal(r.said.textContent, 'Give this agent a name first.');
  assert.equal(r.d.focused(), r.field);
  assert.equal(r.btn.disabled, false, 'the button stays usable');
});

test('a typed name names the agent: it is sent as the name and as the label', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS, created: CREATED });
  r.field.value = '  Claude Pip ';
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.equal(r.calls.length, 2, 'parsed, then created');
  assert.match(r.calls[1].url, /\/api\/agents$/);
  assert.equal(r.calls[1].body.name, 'Claude Pip', 'the engine folds it to a machine name');
  assert.equal(r.calls[1].body.label, 'Claude Pip');
  assert.equal(r.btn.textContent, 'Added to Kosmos');
  assert.equal(r.field.disabled, true, 'the field is done with, like the button');
});

test('control: a row with a name still adds from the file\'s own name, as before', async () => {
  const r = rig({ withField: false, parsed: { ...PARSED_NAMELESS, name: 'don', displayName: 'Don' }, created: CREATED });
  await r.add('/Users/p/Downloads/don.md', r.btn, r.row);
  assert.equal(r.calls[1].body.name, 'don');
  assert.equal(r.calls[1].body.label, 'Don');
});

test('a name the engine refuses shows its reason, and the field and button work again', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS,
    created: { ok: false, httpOk: false, because: 'use letters, numbers, hyphens and underscores, starting with a letter or number' } });
  r.field.value = '!!';
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.match(r.said.textContent, /use letters, numbers, hyphens and underscores/);
  assert.equal(r.field.disabled, false);
  assert.equal(r.btn.disabled, false);
});

test('Enter in the Name field presses that row\'s Add', () => {
  const src = PAGE.slice(PAGE.indexOf('/* kosmos#4962: Enter in a nameless row'), PAGE.indexOf("document.addEventListener('click', (e) => {\n  const btn = e.target.closest('.fr-importgo');"));
  assert.ok(src.length > 0 && src.length < 1200, 'the Enter handler moved; re-anchor this test');
  assert.match(src, /e\.key !== 'Enter'/);
  assert.match(src, /closest\('\.fr-importinput'\)/);
  assert.match(src, /go\.click\(\)/);
});

test('what the person typed is the label even when the file carries a display name of its own', async () => {
  const r = rig({ withField: true, parsed: { ...PARSED_NAMELESS, displayName: 'Template Bot' }, created: CREATED });
  r.field.value = 'Claude Pip';
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.equal(r.calls[1].body.label, 'Claude Pip', 'the row asked them, so their word wins');
});
