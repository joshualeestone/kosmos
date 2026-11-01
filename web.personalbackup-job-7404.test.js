'use strict';
/**
 * kosmos#7404 (pbpanel-7404): the panel's job lines. The function is read out of the page, so this is the page's own text.
 *
 *   node --test web.personalbackup-job-7404.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const m = page.match(/function pbJobLines\(j\) \{[\s\S]*?\n\}\n/);
assert.ok(m, 'pbJobLines is in the page');
const pbJobLines = Function(m[0] + 'return pbJobLines;')();

test('stopped goes alone in its line; the date and a note sit beside it, plain', () => {
  const r = pbJobLines({ lastOk: '2026-10-31T14:07:00.000Z', stopped: 'Stopped.', note: null });
  assert.equal(r.stopped, 'Stopped.');
  assert.match(r.plain, /^Last backed up .*\.$/);
  assert.doesNotMatch(r.stopped, /Last backed up/);
  assert.equal(pbJobLines({ lastOk: null, stopped: null, note: 'A backup runs soon.' }).plain, 'A backup runs soon.');
});
test('nothing established, nothing said: no job, a bad date, an empty answer', () => {
  for (const j of [null, undefined, {}, { lastOk: 'not a date' }, { stopped: 5, note: 5 }]) assert.deepEqual(pbJobLines(j), { stopped: '', plain: '' });
});
test('the panel paints only an on view', () => {
  assert.match(page, /const lines = pbJobLines\(v === 'on' \? st\.job : null\);/);
});
