'use strict';
/**
 * kosmos#8841: Settings says when usage readings or automatic moves are on only because an earlier start switched
 * them on, and when a record of that was found and not applied. paintKept is lifted out of web/index.html and RUN
 * against a stand-in element, so the lines are checked as drawn. (The browser check that also covers them,
 * docs/browser-checks/render-autobalance-7152.js, is not in the set a pull request runs.)
 *
 *   node --test web.kept-switch-8841.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const start = PAGE.indexOf('function paintKept(');
const end = PAGE.indexOf('\n}\n', start);
assert.ok(start > 0 && end > start, 'paintKept moved or was renamed; restate this lift');
const SOURCE = PAGE.slice(start, end + 2);

/* The page's own esc, lifted too, so a date is escaped as the page escapes it. */
const escAt = PAGE.indexOf('function esc(');
assert.ok(escAt > 0, 'esc moved or was renamed');
const ESC = PAGE.slice(escAt, PAGE.indexOf('\n}', escAt) + 2);

function paint(kept, notApplied, { box = { innerHTML: 'stale' } } = {}) {
  const ctx = { document: { getElementById: (id) => (id === 'kept-lines' ? box : null) }, Number, Date };
  vm.createContext(ctx);
  vm.runInContext(ESC + '\n' + SOURCE + '\npaintKept(KEPT, NOT_APPLIED);', Object.assign(ctx, { KEPT: kept, NOT_APPLIED: notApplied }));
  return box === null ? null : String(box.innerHTML).split('</p>').filter(Boolean).map((p) => p.replace(/^<p[^>]*>/, ''));
}
const DAY = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const A = Date.UTC(2026, 10, 6, 15); const B = Date.UTC(2026, 10, 9, 15);

test('CONTROL: nothing kept draws nothing, and takes an earlier read\'s lines away', () => {
  assert.deepEqual(paint({}, false), []);
  assert.deepEqual(paint(null, false), [], 'a failed read (null) left the earlier lines');
  assert.deepEqual(paint(undefined, undefined), []);
});

test('each kept switch has its own line with its own day, and says the switch is still on', () => {
  assert.deepEqual(paint({ usagePoll: A, automove: B }, false), [
    'Usage readings were switched on when Kosmos started on ' + DAY(A) + '. That switch is still on.',
    'Automatic moves were switched on when Kosmos started on ' + DAY(B) + '. That switch is still on.']);
  assert.notEqual(DAY(A), DAY(B), 'CONTROL: the two days differ, so one date for both would have failed above');
  assert.deepEqual(paint({ automove: B }, false), ['Automatic moves were switched on when Kosmos started on ' + DAY(B) + '. That switch is still on.']);
});

test('a time no date can say is "an earlier day", never "Invalid Date"', () => {
  for (const at of [0, -5, 9e15]) {
    assert.deepEqual(paint({ usagePoll: at }, false), ['Usage readings were switched on when Kosmos started on an earlier day. That switch is still on.'], String(at));
  }
  assert.deepEqual(paint({ usagePoll: 'yesterday', automove: null }, false), [], 'a value that is not a time was drawn');
});

test('a record found and not applied is said, with or without a kept switch beside it', () => {
  const NOT = 'Kosmos found a record of switches that were kept on under another computer name, and did not apply it on this computer.';
  assert.deepEqual(paint({}, true), [NOT]);
  assert.deepEqual(paint({ usagePoll: 0 }, true).slice(-1), [NOT]);
  assert.deepEqual(paint({}, 'yes'), [], 'anything but true was read as not applied');
});

test('with no place to draw them (an older page), nothing throws', () => {
  assert.equal(paint({ usagePoll: A }, true, { box: null }), null);
});

test('the accounts read paints them: after a good read with what it said, after a failed one with nothing', () => {
  const at = PAGE.indexOf('async function paintAccounts');
  const fn = PAGE.slice(at, PAGE.indexOf('\nasync function', at + 1));
  assert.match(fn, /keptRead = body\.kept \|\| null;\s*keptNotApplied = body\.keptNotApplied === true;/);
  assert.match(fn, /paintAutobalance\(null, \[\]\);[^\n]*\n\s*paintKept\(null\);/, 'a failed read does not clear the kept lines');
  assert.match(fn, /paintKept\(keptRead, keptNotApplied\);/);
  assert.match(PAGE, /<div id="kept-lines"><\/div>/);
});
