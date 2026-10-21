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
  const make = () => ({ className: '', dataset: {}, textContent: '', parts: [], title: '', append(...c) { this.parts.push(...c); }, insertAdjacentHTML() {} });
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
  const narrow = rowOf(f, true);
  assert.doesNotMatch(narrow.parts[1].textContent, /fingerprint|sha256/, 'the narrow panel row grew a fingerprint (#6497 keeps it to the size)');
  assert.match(narrow.title, new RegExp('^report\\.pdf, changed .*, fingerprint sha256 ' + FP + '$'), 'the whole value is not on the narrow row’s hover');
  const none = rowOf({ name: 'x.txt', size: 1 }, false);
  assert.doesNotMatch(none.parts[1].textContent + none.title, /fingerprint|sha256/, 'CONTROL: a row without one says nothing about it');
});

test('the project rail carries the whole value on hover', () => {
  assert.match(SCRIPT, /w\.textContent = pjSize\(f\.size\);\n\s+if \(fileFingerprint\(f\)\) b\.title = f\.name \+ ', fingerprint sha256 ' \+ fileFingerprint\(f\);/);
});

test('iteration 1: the Documents view fills fingerprints in after it opens, by the same file only, and stops', async () => {
  const fn = page.liftAll(SCRIPT, ['fileFingerprint', 'docsFingerprintFill']) + '\n' + page.liftConst(SCRIPT, 'DOCS_FP_TRIES');
  const run = (answers, view = 'docs') => {
    const st = { PJ_CURRENT: 'p1', PJ_VIEW: view, DOCS_OPEN_GEN: 7, painted: 0, fetched: 0,
      PJ_DOCS_FILES: [{ name: 'a.txt', size: 1, modified: 'm1' }, { name: 'b.txt', size: 2, modified: 'm2' }] };
    const timers = [];
    const api = new Function('st', 'setTimeout', 'fetch',
      'let PJ_DOCS_FILES = st.PJ_DOCS_FILES; const pjDocsPaintPage = () => { st.painted += 1; };\n'
      + fn.replace(/\bPJ_CURRENT\b/g, 'st.PJ_CURRENT').replace(/\bPJ_VIEW\b/g, 'st.PJ_VIEW').replace(/\bDOCS_OPEN_GEN\b/g, 'st.DOCS_OPEN_GEN')
      + '\nreturn docsFingerprintFill;')(st, (f) => { timers.push(f); }, async () => { st.fetched += 1; const a = answers[Math.min(st.fetched - 1, answers.length - 1)]; return { json: async () => a }; });
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
