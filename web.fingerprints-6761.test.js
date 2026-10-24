'use strict';
/* #6761: a Files row's sha256 on the page. The functions are the REAL ones lifted from web/index.html.
 *   - the Files screen (agentFileRow, full row) and the Documents view (pjDocMeta) show "sha256 <first 12 hex>";
 *   - the narrow lists (agentFileRow compact, the project rail) keep their size-only rows and carry the whole value as
 *     hover text, as every row does;
 *   - a row with no fingerprint yet, or a value that is not a whole sha256 hex, shows none.
 *
 *   node --test web.fingerprints-6761.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FP = 'ab'.repeat(32);

const env = new Function(page.liftAll(SCRIPT, ['pjSize', 'fileFingerprint', 'pjDocMeta']) + '\nreturn { pjSize, fileFingerprint, pjDocMeta };')();

function rowOf(f, compact) {
  const make = () => ({ className: '', dataset: {}, textContent: '', parts: [], title: '', attrs: {}, append(...c) { this.parts.push(...c); }, insertAdjacentHTML() {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } });
  const document = { createElement: make };
  const fn = new Function('document', 'fileIcon', page.liftAll(SCRIPT, ['pjSize', 'fileFingerprint', 'agentFileRow']) + '\nreturn agentFileRow;')(document, () => '');
  return fn(f, compact);
}

test('fileFingerprint answers only a whole lowercase sha256 hex, and nothing for a row without one', () => {
  assert.equal(env.fileFingerprint({ sha256: FP }), FP);
  for (const bad of [undefined, null, '', 'ab'.repeat(31), FP.toUpperCase(), FP + 'a', 'sha256:' + FP, '<b>x</b>'.padEnd(64, 'a')]) {
    assert.equal(env.fileFingerprint({ sha256: bad }), '', JSON.stringify(bad));
  }
  assert.equal(env.fileFingerprint(null), '');
});

test('the Documents view shows the first 12 hex after the size and date; none without one', () => {
  const day = new Date('2026-10-20T10:00:00Z').toLocaleDateString();
  assert.equal(env.pjDocMeta({ size: 2048, modified: '2026-10-20T10:00:00Z', sha256: FP }), env.pjSize(2048) + ' · ' + day + ' · fingerprint ' + FP.slice(0, 12));
  assert.equal(env.pjDocMeta({ size: 2048, modified: '2026-10-20T10:00:00Z' }), env.pjSize(2048) + ' · ' + day, 'CONTROL: no fingerprint, no word about one');
});

test('the Files screen row shows the short fingerprint and the whole value on hover; the narrow row keeps size only', () => {
  const f = { name: 'report.pdf', size: 10, modified: '2026-10-20T10:00:00Z', sha256: FP };
  const full = rowOf(f, false);
  assert.match(full.parts[1].textContent, new RegExp(' · fingerprint ' + FP.slice(0, 12) + '$'));
  assert.equal(full.title, 'report.pdf, fingerprint sha256 ' + FP);
  assert.equal(full.getAttribute('aria-description'), 'fingerprint ' + FP.slice(0, 12), 'iteration 7: the spoken description is not the short form');
  const narrow = rowOf(f, true);
  assert.doesNotMatch(narrow.parts[1].textContent, /fingerprint|sha256/, 'the narrow panel row grew a fingerprint (#6497 keeps it to the size)');
  assert.match(narrow.getAttribute('aria-description'), new RegExp('^changed .*, fingerprint ' + FP.slice(0, 12) + '$'), 'iteration 7: the narrow row\u2019s spoken description lost its date or is not short');
  assert.match(narrow.title, new RegExp('^report\\.pdf, changed .*, fingerprint sha256 ' + FP + '$'), 'the whole value is not on the narrow row’s hover');
  const none = rowOf({ name: 'x.txt', size: 1 }, false);
  assert.doesNotMatch(none.parts[1].textContent + none.title, /fingerprint|sha256/, 'CONTROL: a row without one says nothing about it');
  assert.equal(none.getAttribute('aria-description'), null, 'CONTROL: a row without a fingerprint gets no spoken one');
});

test('the project rail carries the whole value on hover', () => {
  assert.match(SCRIPT, /w\.textContent = pjSize\(f\.size\);\n\s+if \(fileFingerprint\(f\)\) b\.title = f\.name \+ ', fingerprint sha256 ' \+ fileFingerprint\(f\);/);
  // Iterations 7-8: every fingerprinted row speaks the short form, through the ATTRIBUTE (a reflection property may be an expando nothing reads).
  assert.equal((SCRIPT.match(/setAttribute\('aria-description', /g) || []).length, 3);
  assert.doesNotMatch(SCRIPT, /\.ariaDescription\b/);
});

test('iteration 1: the Documents view fills fingerprints in after it opens, by the same file only, and stops', async () => {
  const fn = page.liftAll(SCRIPT, ['fileFingerprint', 'docsFingerprintFill']) + '\n' + page.liftConst(SCRIPT, 'DOCS_FP_TRIES');
  const run = (answers, view = 'docs') => {
    const st = { PJ_CURRENT: 'p1', PJ_VIEW: view, DOCS_OPEN_GEN: 7, painted: 0, fetched: 0,
      PJ_DOCS_FILES: [{ name: 'a.txt', size: 1, modified: 'm1' }, { name: 'b.txt', size: 2, modified: 'm2' }] };
    const timers = [];
    /* A stub page: the Documents list holds one row per file; the person's keyboard is on b.txt's row. A repaint makes
       new rows (as pjDocsPaintPage does), so focus is only kept if the fill puts it back. */
    const rowFor = (doc) => ({ dataset: { doc }, focus() { st.refocused = doc; } });
    st.rows = st.PJ_DOCS_FILES.map((f) => rowFor(f.name));
    const box = { contains: (el) => st.rows.includes(el), querySelectorAll: () => st.rows };
    const document = { getElementById: (id) => (id === 'docs-list' ? box : null), get activeElement() { return st.rows[1]; } };
    const api = new Function('st', 'setTimeout', 'fetch', 'document',
      'let PJ_DOCS_FILES = st.PJ_DOCS_FILES; const pjDocsPaintPage = () => { st.painted += 1; st.rows = st.PJ_DOCS_FILES.map((f) => ({ dataset: { doc: f.name }, focus(o) { st.refocused = f.name; st.refocusOpts = o; } })); };\n'
      + fn.replace(/\bPJ_CURRENT\b/g, 'st.PJ_CURRENT').replace(/\bPJ_VIEW\b/g, 'st.PJ_VIEW').replace(/\bDOCS_OPEN_GEN\b/g, 'st.DOCS_OPEN_GEN')
      + '\nreturn docsFingerprintFill;')(st, (f) => { timers.push(f); }, async () => { st.fetched += 1; const a = answers[Math.min(st.fetched - 1, answers.length - 1)]; return { json: async () => a }; }, document);
    return { st, timers, fill: api };
  };
  const drain = async (t, max = 50) => { for (let i = 0; i < max && t.timers.length; i++) await t.timers.shift()(); };
  // The first read has a, then b: both fill in, the page repaints, and it stops once every row has one.
  const ok = run([{ files: [{ name: 'a.txt', size: 1, modified: 'm1', sha256: FP }] }, { files: [{ name: 'a.txt', size: 1, modified: 'm1', sha256: FP }, { name: 'b.txt', size: 2, modified: 'm2', sha256: 'cd'.repeat(32) }] }]);
  ok.fill('p1', 7, 0);
  await drain(ok);
  assert.deepEqual(ok.st.PJ_DOCS_FILES.map((f) => f.sha256), [FP, 'cd'.repeat(32)]);
  assert.equal(ok.st.painted, 2);
  assert.equal(ok.st.fetched, 2, 'it kept reading after every row had its fingerprint');
  assert.equal(ok.st.refocused, 'b.txt', 'iteration 2: the row the keyboard was on lost focus to the repaint');
  assert.equal(ok.st.refocusOpts && ok.st.refocusOpts.preventScroll, true, 'iteration 6: the Documents fill scrolled the page');
  // A newer version of a file (another date) is never given to the row the person is looking at.
  const newer = run([{ files: [{ name: 'a.txt', size: 1, modified: 'LATER', sha256: FP }] }]);
  newer.fill('p1', 7, 0);
  await drain(newer);
  assert.equal(newer.st.PJ_DOCS_FILES[0].sha256, undefined, 'a newer file\u2019s fingerprint was put on the listed one');
  assert.ok(newer.st.fetched <= 15, 'unbounded: ' + newer.st.fetched);
  // The person left the view: nothing is read.
  const left = run([{ files: [] }], 'project');
  left.fill('p1', 7, 0);
  await drain(left);
  assert.equal(left.st.fetched, 0);
});

test('iteration 5: the polled Files lists give the keyboard back to the same row when a fingerprint repaints them', () => {
  const rows = (names) => names.map(([k, v]) => ({ dataset: { [k]: v }, focus(o) { st.focused = k + ':' + v; st.opts = o; } }));
  const st = { focused: null };
  let kids = rows([['dir', 'reports'], ['doc', 'a.txt'], ['doc', 'b.txt']]);
  const box = { contains: (el) => kids.includes(el), querySelectorAll: () => kids };
  const doc = { activeElement: kids[2] };
  const fns = new Function('document', page.liftAll(SCRIPT, ['rowKey', 'focusedRowKey', 'refocusRow']) + '\nreturn { focusedRowKey, refocusRow };')(doc);
  const key = fns.focusedRowKey(box);
  assert.equal(key, 'doc:b.txt');
  kids = rows([['dir', 'reports'], ['doc', 'a.txt'], ['doc', 'b.txt']]);   // the repaint makes new rows
  fns.refocusRow(box, key);
  assert.equal(st.focused, 'doc:b.txt', 'focus was not put back on the same file');
  assert.equal(st.opts && st.opts.preventScroll, true, 'iteration 6: putting focus back scrolled the page to the row');
  doc.activeElement = { dataset: { doc: 'elsewhere' } };   // CONTROL: the keyboard is outside the list
  assert.equal(fns.focusedRowKey(box), null, 'focus outside the list was pulled into it');
  st.focused = null;
  fns.refocusRow(box, 'doc:gone.txt');
  assert.equal(st.focused, null, 'a file no longer listed moved the focus');
  // All three repaint paths use them: the narrow panel, the Files screen, the project rail.
  assert.equal((SCRIPT.match(/const hadFocus = focusedRowKey\((list|box)\);/g) || []).length, 3);
  assert.equal((SCRIPT.match(/refocusRow\((list|box), hadFocus\);/g) || []).length, 3);
});

test('iteration 7: the project room is rebuilt only when the folder\u2019s NAMES change, not when a fingerprint arrives', () => {
  const { sameDocNames } = new Function(page.liftAll(SCRIPT, ['sameDocNames']) + '\nreturn { sameDocNames };')();
  assert.equal(sameDocNames(new Set(['a', 'b']), new Set(['b', 'a'])), true);
  assert.equal(sameDocNames(new Set(['a', 'b']), new Set(['a', 'c'])), false, 'CONTROL: a renamed file is a change');
  assert.equal(sameDocNames(new Set(['a']), new Set(['a', 'b'])), false, 'CONTROL: a new file is a change');
  assert.equal(sameDocNames(null, new Set(['a'])), false, 'CONTROL: the first names to land are a change');
  assert.equal(sameDocNames(null, null), true);
  const load = page.lift(SCRIPT, 'pjLoadDocs');
  assert.match(load, /const namesBefore = PJ_DOC_NAMES;\n\s+PJ_DOC_NAMES = /);
  assert.match(load, /if \(roomBox && !sameDocNames\(namesBefore, PJ_DOC_NAMES\)\) \{ roomBox\.__lastRoom = undefined;/, 'the room is rebuilt on every rail repaint again');
});
