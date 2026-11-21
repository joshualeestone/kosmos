'use strict';
/**
 * kosmos#8841: when usage readings or automatic moves are switched off where Kosmos is started (not in Settings),
 * Settings says so instead of only saying that nothing is recorded or moved. paintAutobalance is lifted out of
 * web/index.html and RUN against stand-in elements, so the lines are checked as drawn.
 *
 *   node --test web.autobalance-off-outside-8841.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function lift(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  const end = PAGE.indexOf('\n}\n', at);
  assert.ok(at > 0 && end > at, name + ' moved or was renamed; restate this lift');
  return PAGE.slice(at, end + 2);
}
const SOURCE = lift('paintAutobalance') + lift('esc');

function paint(ab) {
  const el = () => ({ innerHTML: '', hidden: false });
  const els = { 'ab-row': el(), 'ab-lines': el(), 'ab-recent': el(), 'ab-dry': el() };
  const ctx = { document: { getElementById: (id) => els[id] || null }, paintSwitch: () => {}, acctPrimaryName: (a) => a.dir,
    abRecentHtml: () => '', LAST: [], AB: ab };
  vm.createContext(ctx);
  vm.runInContext(SOURCE + '\npaintAutobalance(AB, []);', ctx);
  return els['ab-recent'].innerHTML;
}
const base = { on: true, ok: true, eligible: 2, moves: [], held: [], short: [], atRisk: [], recent: [], recording: true, moving: false };
const OUTSIDE = 'where Kosmos is started, not here in Settings';

test('CONTROL: with nothing switched off outside Settings the lines are as before', () => {
  assert.match(paint(base), /Kosmos does not move agents on its own yet/);
  assert.match(paint({ ...base, recording: false }), /not keeping a record of what it would move on this computer\.</);
  assert.ok(!paint({ ...base, offOutside: { readings: false, moves: false } }).includes(OUTSIDE));
  assert.ok(!paint({ ...base, recording: false, offOutside: { readings: false, moves: false } }).includes(OUTSIDE));
});

test('moves switched off where Kosmos is started are named as the reason nothing moves', () => {
  const html = paint({ ...base, offOutside: { readings: false, moves: true } });
  assert.match(html, /does not move agents on this computer, because automatic moves are switched off where Kosmos is started/);
  assert.ok(!html.includes('on its own yet'), 'the "not yet" line was drawn beside the reason');
  /* After a run, the record holds mover lines: the reason still replaces the "not moving now" line. */
  const after = paint({ ...base, recent: [{ kind: 'moved' }], offOutside: { readings: false, moves: true } });
  assert.match(after, /because automatic moves are switched off/);
  assert.ok(!after.includes('is not moving agents on this computer now'));
});

test('a board that moves says it moves, whatever offOutside says (the page never says off where it moves)', () => {
  const html = paint({ ...base, moving: true, offOutside: { readings: false, moves: true } });
  assert.match(html, /moves them itself/);
  assert.ok(!html.includes(OUTSIDE));
});

test('readings switched off where Kosmos is started are named as the reason nothing is recorded', () => {
  const html = paint({ ...base, recording: false, offOutside: { readings: true, moves: true } });
  assert.match(html, /not keeping a record .* because usage readings are switched off where Kosmos is started/);
});

test('Settings switched off shows no record lines at all, so no outside reason either', () => {
  assert.equal(paint({ ...base, on: false, offOutside: { readings: true, moves: true } }), '');
});
