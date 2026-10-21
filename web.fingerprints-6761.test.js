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
  assert.equal(env.pjDocMeta({ size: 2048, modified: '2026-10-20T10:00:00Z', sha256: FP }), env.pjSize(2048) + ' · ' + day + ' · sha256 ' + FP.slice(0, 12));
  assert.equal(env.pjDocMeta({ size: 2048, modified: '2026-10-20T10:00:00Z' }), env.pjSize(2048) + ' · ' + day, 'CONTROL: no fingerprint, no word about one');
});

test('the Files screen row shows the short fingerprint and the whole value on hover; the narrow row keeps size only', () => {
  const f = { name: 'report.pdf', size: 10, modified: '2026-10-20T10:00:00Z', sha256: FP };
  const full = rowOf(f, false);
  assert.match(full.parts[1].textContent, new RegExp(' · sha256 ' + FP.slice(0, 12) + '$'));
  assert.equal(full.title, 'report.pdf, sha256 ' + FP);
  const narrow = rowOf(f, true);
  assert.doesNotMatch(narrow.parts[1].textContent, /sha256/, 'the narrow panel row grew a fingerprint (#6497 keeps it to the size)');
  assert.match(narrow.title, new RegExp('^report\\.pdf, changed .*, sha256 ' + FP + '$'), 'the whole value is not on the narrow row’s hover');
  const none = rowOf({ name: 'x.txt', size: 1 }, false);
  assert.doesNotMatch(none.parts[1].textContent + none.title, /sha256/, 'CONTROL: a row without one says nothing about it');
});

test('the project rail carries the whole value on hover', () => {
  assert.match(SCRIPT, /w\.textContent = pjSize\(f\.size\);\n\s+if \(fileFingerprint\(f\)\) b\.title = f\.name \+ ', sha256 ' \+ fileFingerprint\(f\);/);
});
