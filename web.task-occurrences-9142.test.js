'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9142: the task page's recent runs and misses, from the page's real functions (lifted, as web.task-told-5836):
   one row per occurrence, worded for the person ("you", agents by their card names), text only, a missed or late row
   marked, and nothing shown when there are no rows. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);

// A tiny document: the two elements the painter uses, and enough of createElement for <li>.
function fakeDoc() {
  const el = (id) => ({ id, hidden: true, dataset: {}, children: [], textContent: '',
    appendChild(c) { this.children.push(c); }, set _t(v) { this.textContent = v; } });
  const box = el('tk-occurrences');
  const list = el('tk-occ-list');
  Object.defineProperty(list, 'textContent', { get() { return this._tc || ''; }, set(v) { this._tc = v; if (v === '') this.children = []; } });
  return {
    box, list,
    getElementById: (id) => (id === 'tk-occurrences' ? box : id === 'tk-occ-list' ? list : null),
    createElement: () => { const cls = new Set(); return { textContent: '', classList: { add: (c) => cls.add(c), has: (c) => cls.has(c) } }; },
  };
}
const make = (doc) => new Function('LAST', 'document', page.liftAll(SCRIPT, ['tskAgentName', 'tkOccWhen', 'tkOccWords', 'tkPaintOccurrences'])
  + '\nreturn { tkOccWords, tkPaintOccurrences };')([{ sessionName: 'nova', name: 'Nova' }, { sessionName: 'quill', name: 'Quill' }], doc);

test('each kind of row is worded for the person, with agents by their card names', () => {
  const lib = make(fakeDoc());
  assert.match(lib.tkOccWords({ kind: 'delivered', due: '2026-11-21T15:00:00Z', at: '2026-11-21T15:02:00Z', late: false, by: 'nova' }), /^Due .+: delivered on time, .+, by Nova$/);
  assert.match(lib.tkOccWords({ kind: 'delivered', due: '2026-11-22T15:00:00Z', at: '2026-11-22T17:00:00Z', late: true, person: true }), /: delivered late, .+, by you$/);
  assert.match(lib.tkOccWords({ kind: 'missed', due: '2026-11-23T15:00:00Z', count: 1, review: 'told', who: 'quill' }), /: missed; Quill was told$/);
  assert.match(lib.tkOccWords({ kind: 'missed', due: '2026-11-23T15:00:00Z', count: 3, more: true, review: 'unreached', who: 'quill' }), /: missed \(3 or more runs\); Quill could not be reached$/);
  assert.match(lib.tkOccWords({ kind: 'missed', due: '2026-11-23T15:00:00Z', review: 'asked' }), /; it waited for you in Needs Your Decision$/);
  assert.match(lib.tkOccWords({ kind: 'missed', due: '2026-11-23T15:00:00Z', count: 2, review: 'recovered' }), /: missed \(2 runs\); a later run caught up$/);
  assert.match(lib.tkOccWords({ kind: 'missed', due: '2026-11-23T15:00:00Z', review: 'open', open: true }), /: missed; no run since$/);
  assert.equal(lib.tkOccWords({ kind: 'something new' }), '');
});

test('the painter draws one row each, marks a missed or late row on ITS line, and hides when there are none', () => {
  const doc = fakeDoc();
  const lib = make(doc);
  lib.tkPaintOccurrences([
    { kind: 'missed', due: '2026-11-23T15:00:00Z', review: 'open', open: true },
    { kind: 'odd' },   // no words: left out, and must not shift the marks onto the wrong line
    { kind: 'delivered', due: '2026-11-22T15:00:00Z', at: '2026-11-22T15:01:00Z', late: false, by: 'nova' },
    { kind: 'delivered', due: '2026-11-21T15:00:00Z', at: '2026-11-21T18:00:00Z', late: true, by: 'nova' },
  ], 'p#1');
  assert.equal(doc.box.hidden, false);
  assert.equal(doc.list.children.length, 3);
  assert.deepEqual(doc.list.children.map((li) => li.classList.has('tk-occ-off')), [true, false, true]);
  lib.tkPaintOccurrences([], 'p#1');
  assert.equal(doc.box.hidden, true, 'an empty list was left showing');
});

test('review 1: a failed read keeps this task\'s rows, and clears another task\'s', () => {
  const doc = fakeDoc();
  const lib = make(doc);
  const rows = [{ kind: 'delivered', due: '2026-11-22T15:00:00Z', at: '2026-11-22T15:01:00Z', by: 'nova' }];
  lib.tkPaintOccurrences(rows, 'p#1');
  lib.tkPaintOccurrences(null, 'p#1');
  assert.equal(doc.box.hidden, false, 'a failed read of the same task cleared its rows');
  assert.equal(doc.list.children.length, 1);
  lib.tkPaintOccurrences(null, 'p#2');
  assert.equal(doc.box.hidden, true, 'task 1\'s rows stayed showing under task 2');
  assert.equal(doc.list.children.length, 0);
});

test('text only: a name that looks like markup is shown as text, never parsed', () => {
  const src = page.liftAll(SCRIPT, ['tkPaintOccurrences']);
  assert.doesNotMatch(src, /innerHTML/, 'the painter writes markup');
});

test('the markup has the list, hidden, and the loader hands the occurrences to the painter behind a guard', () => {
  assert.match(HTML, /<div id="tk-occurrences" class="tk-occ" hidden>.*<ul id="tk-occ-list"/);
  const loader = page.liftAll(SCRIPT, ['paintTaskActivity']);
  assert.match(loader, /occurrences = Array\.isArray\(out\.occurrences\) \? out\.occurrences : \[\];/);
  assert.match(loader, /if \(typeof tkPaintOccurrences === 'function'\) tkPaintOccurrences\(occurrences, p\.id \+ '#' \+ n\);/);
  assert.match(loader, /tkPaintOccurrences\(null, p\.id \+ '#' \+ n\)/, 'a failed read does not tell the painter');
});
