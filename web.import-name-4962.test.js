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
  assert.match(rows[0], new RegExp('aria-describedby="' + m[1] + '-help ' + m[1] + '-said"'), 'the helper and the error line describe the field');
  assert.match(rows[0], new RegExp('class="fr-importsaid"[^>]*id="' + m[1] + '-said"'), 'the error line carries that id');
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
  if (withField) {
    field = t.create('input'); field.className = 'tk-inp fr-importinput';
    field.removeAttribute = function (k) { delete this.attrs[k]; };
    row.appendChild(field);
  }
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
  const add = new Function('document', 'fetch', 'const IMPORT_ADDS = new Map();\n' + slice('importRowApply') + '\n' + slice('importRowsSync') + '\n'
    + slice('addImportedInPlace') + '\nreturn addImportedInPlace;')(t.document, fetchImpl);
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
  assert.equal(r.field.getAttribute('aria-invalid'), 'true');
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

test('a name the engine refuses (field: name) shows its reason, and the field and button work again', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS,
    created: { ok: false, httpOk: false, field: 'name', because: 'use letters, numbers, hyphens and underscores, starting with a letter or number' } });
  r.field.value = '!!';
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.match(r.said.textContent, /use letters, numbers, hyphens and underscores/);
  assert.equal(r.field.disabled, false);
  assert.equal(r.btn.disabled, false);
  assert.equal(r.d.focused(), r.field, 'the cursor is back in the field to correct it (review 1)');
  assert.equal(r.field.getAttribute('aria-invalid'), 'true', 'and the field is marked invalid');
});


test('what the person typed is the label even when the file carries a display name of its own', async () => {
  const r = rig({ withField: true, parsed: { ...PARSED_NAMELESS, displayName: 'Template Bot' }, created: CREATED });
  r.field.value = 'Claude Pip';
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.equal(r.calls[1].body.label, 'Claude Pip', 'the row asked them, so their word wins');
});

/* The two Enter handlers, run for real against fake events (review 1: the source-text test could not see
   first run's Enter-means-Continue firing as well). */
function enterRig() {
  const t = makeDom();
  const fr = t.add('firstrun');
  const next = t.add('fr-next', 'button');
  let nextClicks = 0; next.click = () => { nextClicks += 1; };
  const row = t.create('div'); row.className = 'fr-importrow';
  const field = t.create('input'); field.className = 'tk-inp fr-importinput';
  const go = t.create('button'); go.className = 'btn uprime fr-importgo';
  let goClicks = 0; go.click = () => { goClicks += 1; };
  row.append(field, go); fr.appendChild(row);
  const other = t.create('input'); other.className = 'tk-inp'; other.type = 'text'; fr.appendChild(other);
  // eslint-disable-next-line no-new-func
  const api = new Function('document', slice('frEnterSubmit') + '\n' + slice('importNameEnter') + '\nreturn { frEnterSubmit, importNameEnter };')(t.document);
  const ev = (target, extra) => Object.assign({ key: 'Enter', target, defaultPrevented: false, isComposing: false, repeat: false,
    preventDefault() { this.defaultPrevented = true; } }, extra || {});
  return { api, field, go, other, ev, counts: () => ({ next: nextClicks, go: goClicks }) };
}

test('Enter in the Name field on first run adds that row and does NOT press Continue', () => {
  const r = enterRig();
  const e = r.ev(r.field);
  r.api.frEnterSubmit(e);      // #firstrun's handler runs first (it is on an ancestor)
  r.api.importNameEnter(e);    // then the document's
  assert.deepEqual(r.counts(), { next: 0, go: 1 });
});

test('control: Enter in an ordinary first-run text field still presses Continue, and does not add', () => {
  const r = enterRig();
  const e = r.ev(r.other);
  r.api.frEnterSubmit(e);
  r.api.importNameEnter(e);
  assert.deepEqual(r.counts(), { next: 1, go: 0 });
});

test('Enter while composing, or with Add disabled, or already handled, does nothing', () => {
  const r = enterRig();
  r.api.importNameEnter(r.ev(r.field, { isComposing: true }));
  r.go.disabled = true; r.api.importNameEnter(r.ev(r.field)); r.go.disabled = false;
  r.api.importNameEnter(r.ev(r.field, { defaultPrevented: true }));
  assert.deepEqual(r.counts(), { next: 0, go: 0 });
});

test('the two surfaces give the same file different field ids (both can be in the page)', () => {
  const items = [{ file: '/Users/p/Downloads/pip.md', name: '' }];
  const id = (h) => /class="tk-inp fr-importinput" id="([^"]+)"/.exec(h)[1];
  assert.notEqual(id(foundImportRowsHtml(items, 'cf')), id(foundImportRowsHtml(items, 'fr')));
});

test('a typed name and the cursor survive a redraw of the list', () => {
  const t = makeDom();
  const box = t.add('import-found');
  const build = () => {
    box.textContent = '';
    const row = t.create('div'); row.className = 'fr-importrow'; row.setAttribute('data-import-file', '/Users/p/Downloads/pip.md');
    const f = t.create('input'); f.className = 'tk-inp fr-importinput'; row.appendChild(f); box.appendChild(row);
    return f;
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'const IMPORT_ADDS = new Map();\n' + slice('importRowApply') + '\n' + slice('importNamesKept') + '\n' + slice('importNamesRestore') + '\nreturn { importNamesKept, importNamesRestore };')(t.document);
  const f1 = build(); f1.value = 'Claude Pip'; f1.focus();
  const kept = api.importNamesKept(box);
  const f2 = build();
  assert.equal(f2.value, '', 'control: the redraw alone empties it');
  api.importNamesRestore(box, kept);
  assert.equal(f2.value, 'Claude Pip');
  assert.equal(t.focused(), f2);
});

test('review 2: a refusal that is NOT about the name re-enables the field but does not mark it invalid or move the cursor', async () => {
  const r = rig({ withField: true, parsed: { ...PARSED_NAMELESS, provider: 'openai' },
    created: { ok: false, httpOk: false, because: 'connect an OpenAI account first' } });
  r.field.value = 'Pip';
  r.btn.focus();
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.match(r.said.textContent, /connect an OpenAI account first/);
  assert.equal(r.field.disabled, false, 'the field works again');
  assert.equal(r.field.getAttribute('aria-invalid'), null, 'the name is not called invalid');
  assert.notEqual(r.d.focused(), r.field, 'the cursor is not moved into the name');
});

test('review 2: a redraw during an add shows the new row as adding, then added, never ready to add again', async () => {
  const t = makeDom();
  const box = t.add('import-found');
  const FILE = '/Users/p/Downloads/pip.md';
  const mk = () => {
    box.textContent = '';
    const row = t.create('div'); row.className = 'fr-importrow'; row.setAttribute('data-import-file', FILE);
    const cls = (el) => { el.classList = { add(c) { el.className += ' ' + c; } }; return el; };
    cls(row);
    const name = t.create('span'); name.className = 'fr-importname'; name.textContent = 'An agent file with no name in it';
    const field = t.create('input'); field.className = 'tk-inp fr-importinput'; field.removeAttribute = function (k) { delete this.attrs[k]; };
    const go = cls(t.create('button')); go.className = 'btn uprime fr-importgo'; go.textContent = 'Add to Kosmos';
    const said = t.create('p'); said.className = 'fr-importsaid';
    row.append(name, field, go, said); box.appendChild(row);
    return { row, field, go, name };
  };
  let release;
  const fetchImpl = async (url) => {
    if (/agent-import-file$/.test(url)) { await new Promise((res) => { release = res; }); return { ok: true, json: async () => PARSED_NAMELESS }; }
    return { ok: true, json: async () => CREATED };
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'const IMPORT_ADDS = new Map();\n' + slice('importRowApply') + '\n' + slice('importRowsSync') + '\n'
    + slice('importNamesKept') + '\n' + slice('importNamesRestore') + '\n' + slice('addImportedInPlace')
    + '\nreturn { addImportedInPlace, importNamesKept, importNamesRestore };')(t.document, fetchImpl);
  const first = mk();
  first.field.value = 'Pip';
  const adding = api.addImportedInPlace(FILE, first.go, first.row);
  await Promise.resolve();
  const kept = api.importNamesKept(box);
  const second = mk();                         // the scan's second phase repaints the list
  api.importNamesRestore(box, kept);
  assert.equal(second.go.disabled, true, 'the redrawn row is not ready to add again');
  assert.equal(second.field.disabled, true);
  assert.match(second.go.textContent, /^Adding/);
  release();
  await adding;
  assert.equal(second.go.textContent, 'Added to Kosmos', 'the receipt lands on the row on screen');
  assert.equal(second.name.textContent, 'Pip');
});

test('review 2: a held Enter (key repeat) does not press Add again', () => {
  const r = enterRig();
  r.api.importNameEnter(r.ev(r.field, { repeat: true }));
  assert.deepEqual(r.counts(), { next: 0, go: 0 });
});

test('review 2: Enter in a first-run adopt field does not press Continue either', () => {
  const r = enterRig();
  r.other.className = 'fr-adoptinput';   // the ordinary text field, now an adopt row's name field
  r.api.frEnterSubmit(r.ev(r.other));
  assert.equal(r.counts().next, 0);
});

test('review 3: a refusal during a redraw shows its reason on the row on screen, which is ready again', async () => {
  const t = makeDom();
  const box = t.add('import-found');
  const FILE = '/Users/p/Downloads/pip.md';
  const mk = () => {
    box.textContent = '';
    const row = t.create('div'); row.className = 'fr-importrow'; row.setAttribute('data-import-file', FILE);
    const cls = (el) => { el.classList = { add(c) { el.className += ' ' + c; } }; return el; };
    cls(row);
    const field = t.create('input'); field.className = 'tk-inp fr-importinput'; field.removeAttribute = function (k) { delete this.attrs[k]; };
    const go = cls(t.create('button')); go.className = 'btn uprime fr-importgo'; go.textContent = 'Add to Kosmos';
    const said = t.create('p'); said.className = 'fr-importsaid';
    row.append(field, go, said); box.appendChild(row);
    return { row, field, go, said };
  };
  let release;
  const fetchImpl = async (url) => {
    if (/agent-import-file$/.test(url)) { await new Promise((res) => { release = res; }); return { ok: true, json: async () => PARSED_NAMELESS }; }
    return { ok: false, json: async () => ({ outcome: 'refused', field: 'name', because: 'an agent called pip is already here' }) };
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'const IMPORT_ADDS = new Map();\n' + slice('importRowApply') + '\n' + slice('importAddsNewVisit') + '\n' + slice('importRowsSync') + '\n'
    + slice('importNamesKept') + '\n' + slice('importNamesRestore') + '\n' + slice('addImportedInPlace')
    + '\nreturn { addImportedInPlace, importNamesKept, importNamesRestore };')(t.document, fetchImpl);
  const first = mk();
  first.field.value = 'Pip';
  const adding = api.addImportedInPlace(FILE, first.go, first.row);
  await Promise.resolve();
  const kept = api.importNamesKept(box);
  const second = mk();
  api.importNamesRestore(box, kept);
  assert.equal(second.go.disabled, true, 'control: the redrawn row shows the add in flight');
  release();
  await adding;
  assert.equal(second.go.disabled, false, 'the row on screen is ready again, not stuck');
  assert.equal(second.go.textContent, 'Add to Kosmos');
  assert.equal(second.field.disabled, false);
  assert.match(second.said.textContent, /already here/, 'the reason shows where the person is looking');
  assert.equal(second.field.getAttribute('aria-invalid'), 'true');
  assert.equal(t.focused(), second.field);
});

test('review 3: a fresh visit to the list forgets receipts, but keeps an add still in flight', () => {
  // eslint-disable-next-line no-new-func
  const api = new Function('const IMPORT_ADDS = new Map([[\'a\', { state: \'added\', name: \'A\' }], [\'b\', { state: \'adding\', name: \'B\' }]]);\n'
    + slice('importAddsNewVisit') + '\nreturn { IMPORT_ADDS, importAddsNewVisit };')();
  api.importAddsNewVisit();
  assert.deepEqual([...api.IMPORT_ADDS.keys()], ['b']);
  const src = slice('populateFoundImports');
  assert.match(src, /\+\+FR_IMPORT_POP_GEN;\s*\n[\s\S]{0,600}importAddsNewVisit\(\)/, 'each visit (a new generation) forgets receipts');
});

test('review 3: each nameless field is told apart by its file for assistive tech', () => {
  const html = foundImportRowsHtml([{ file: '/a/triage.md', name: '' }, { file: '/a/site-monitor.md', name: '' }]);
  const labels = [...html.matchAll(/class="tk-inp fr-importinput"[^>]*aria-label="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(labels, ['Name, /a/triage.md', 'Name, /a/site-monitor.md'], 'the visible word first, then the file');
});

test('review 3: typing again clears the old reason along with the invalid mark', () => {
  const t = makeDom();
  const row = t.create('div'); row.className = 'fr-importrow';
  const f = t.create('input'); f.className = 'tk-inp fr-importinput'; f.removeAttribute = function (k) { delete this.attrs[k]; };
  f.setAttribute('aria-invalid', 'true');
  const said = t.create('p'); said.className = 'fr-importsaid'; said.textContent = 'Give this agent a name first.';
  row.append(f, said);
  // eslint-disable-next-line no-new-func
  const api = new Function(slice('importNameInput') + '\nreturn { importNameInput };')();
  api.importNameInput({ target: f });
  assert.equal(f.getAttribute('aria-invalid'), null);
  assert.equal(said.textContent, '');
});

test('review 3: Enter in a first-run adopt field adds that row', () => {
  const t = makeDom();
  const row = t.create('div'); row.className = 'fr-foundrow fr-adoptrow';
  const f = t.create('input'); f.className = 'fr-adoptinput';
  const go = t.create('button'); go.className = 'btn uprime fr-foundgo';
  let clicks = 0; go.click = () => { clicks += 1; };
  row.append(f, go);
  // eslint-disable-next-line no-new-func
  const api = new Function(slice('importNameEnter') + '\nreturn { importNameEnter };')();
  api.importNameEnter({ key: 'Enter', target: f, defaultPrevented: false, isComposing: false, repeat: false, preventDefault() { this.defaultPrevented = true; } });
  assert.equal(clicks, 1);
});

test('review 4: an input method\'s Enter (keyCode 229) or a modified Enter does not press Add', () => {
  const r = enterRig();
  r.api.importNameEnter(r.ev(r.field, { keyCode: 229 }));
  r.api.importNameEnter(r.ev(r.field, { metaKey: true }));
  r.api.importNameEnter(r.ev(r.field, { shiftKey: true }));
  assert.deepEqual(r.counts(), { next: 0, go: 0 });
  r.api.importNameEnter(r.ev(r.field));
  assert.equal(r.counts().go, 1, 'control: a plain Enter does');
});

test('review 4: a refusal not about the name clears an invalid mark left by an earlier name refusal', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS, created: { ok: false, httpOk: false, because: 'we could not reach the board' } });
  r.field.value = 'Pip';
  r.field.setAttribute('aria-invalid', 'true');
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.equal(r.field.getAttribute('aria-invalid'), null);
});

test('review 4: an added row\'s name is not put back into a fresh field on the next visit', () => {
  const t = makeDom();
  const box = t.add('import-found');
  const row = t.create('div'); row.className = 'fr-importrow'; row.setAttribute('data-import-file', '/p/pip.md');
  const f = t.create('input'); f.className = 'tk-inp fr-importinput'; f.value = 'Pip'; f.disabled = true;
  row.appendChild(f); box.appendChild(row);
  // eslint-disable-next-line no-new-func
  const api = new Function('document', slice('importNamesKept') + '\nreturn { importNamesKept };')(t.document);
  assert.equal(api.importNamesKept(box).size, 0);
});

test('review 5: after Enter in the field, a refusal not about the name gives focus back to the field', async () => {
  const r = rig({ withField: true, parsed: { ...PARSED_NAMELESS, provider: 'openai' },
    created: { ok: false, httpOk: false, because: 'connect an OpenAI account first' } });
  r.field.value = 'Pip';
  // As a browser does (the fake DOM does not): disabling the focused field drops focus to the page.
  const page = r.d.create('div'); page.tabIndex = -1;
  let dis = false;
  Object.defineProperty(r.field, 'disabled', { get() { return dis; }, set(v) { dis = v; if (v && r.d.focused() === r.field) page.focus(); } });
  r.field.focus();                                    // the person pressed Enter in the field
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row);
  assert.equal(r.d.focused(), r.field, 'not left on the page');
  assert.equal(r.field.getAttribute('aria-invalid'), null, 'and still not called invalid');
});

test('review 5/6: after a successful add FROM THE KEYBOARD, focus moves to the next row that can still be added', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS, created: CREATED });
  const box = r.d.create('div');
  box.appendChild(r.row); r.row.parentElement = box;
  const done = r.d.create('div'); done.className = 'fr-importrow done';
  const doneGo = r.d.create('button'); doneGo.className = 'btn uprime fr-importgo'; doneGo.disabled = true;
  done.appendChild(doneGo); box.appendChild(done);
  const next = r.d.create('div'); next.className = 'fr-importrow';
  const nextGo = r.d.create('button'); nextGo.className = 'btn uprime fr-importgo';
  next.appendChild(nextGo); box.appendChild(next);
  r.field.value = 'Pip';
  r.field.focus();
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row, true);
  assert.equal(r.btn.textContent, 'Added to Kosmos', 'control: it was added');
  assert.equal(r.d.focused(), nextGo, 'past the row already added, to the next one');
});

test('review 6: a pointer add (click detail 1) leaves focus where it was', async () => {
  const r = rig({ withField: true, parsed: PARSED_NAMELESS, created: CREATED });
  const box = r.d.create('div');
  box.appendChild(r.row); r.row.parentElement = box;
  const next = r.d.create('div'); next.className = 'fr-importrow';
  const nextField = r.d.create('input'); nextField.className = 'tk-inp fr-importinput';
  next.appendChild(nextField); box.appendChild(next);
  r.field.value = 'Pip';
  r.btn.focus();                         // Chrome focuses a clicked button
  await r.add('/Users/p/Downloads/pip.md', r.btn, r.row, false);
  assert.equal(r.btn.textContent, 'Added to Kosmos');
  assert.notEqual(r.d.focused(), nextField, 'no jump into the next field (a phone would open its keyboard)');
});

test('review 6: a refusal shown just before a redraw is still shown, and still marked, after it', () => {
  const t = makeDom();
  const box = t.add('import-found');
  const build = () => {
    box.textContent = '';
    const row = t.create('div'); row.className = 'fr-importrow'; row.setAttribute('data-import-file', '/p/pip.md');
    const f = t.create('input'); f.className = 'tk-inp fr-importinput';
    const said = t.create('p'); said.className = 'fr-importsaid';
    row.append(f, said); box.appendChild(row);
    return { f, said };
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'const IMPORT_ADDS = new Map();\n' + slice('importRowApply') + '\n' + slice('importNamesKept') + '\n' + slice('importNamesRestore') + '\nreturn { importNamesKept, importNamesRestore };')(t.document);
  const a = build(); a.said.textContent = 'Give this agent a name first.'; a.f.setAttribute('aria-invalid', 'true'); a.f.focus();
  const kept = api.importNamesKept(box);
  const b = build();
  api.importNamesRestore(box, kept);
  assert.equal(b.said.textContent, 'Give this agent a name first.');
  assert.equal(b.f.getAttribute('aria-invalid'), 'true');
  assert.equal(t.focused(), b.f);
});

test('review 6: the click handler tells a keyboard click (detail 0) from a pointer one', () => {
  const t = makeDom();
  const row = t.create('div'); row.className = 'fr-importrow'; row.setAttribute('data-import-file', '/p/pip.md');
  const go = t.create('button'); go.className = 'btn uprime fr-importgo'; row.appendChild(go);
  const seen = [];
  // eslint-disable-next-line no-new-func
  const api = new Function('addImportedInPlace', slice('importGoClick') + '\nreturn { importGoClick };')((...a) => seen.push(a[3]));
  api.importGoClick({ target: go, detail: 0 });
  api.importGoClick({ target: go, detail: 1 });
  assert.deepEqual(seen, [true, false]);
});
