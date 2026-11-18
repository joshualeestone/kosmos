'use strict';
/*
 * kosmos#8698: `kosmos feedback list --mine` lists only the asking agent's own days (engine/feedback.mineLines), and
 * the plain list's note names that flag when other agents' days are in it too. On a throwaway store with NAMED writers.
 */
require('../test-support/tmpscope');   // this process's temp folders, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbmine-8698-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');

function fresh() { fs.rmSync(fb.dir(), { recursive: true, force: true }); }

test('CONTROL: the store is the throwaway folder', () => {
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

test('mineLines: only the days holding this writer\'s own section, newest first; none is a sentence', () => {
  fresh();
  fb.write('mara one', { from: 'mara', date: '2026-11-01' });
  fb.write('leo two', { from: 'leo', date: '2026-11-02' });
  fb.write('mara three', { from: 'Mara', date: '2026-11-03' });
  fb.write('leo three', { from: 'leo', date: '2026-11-03' });
  fb.write('   ', { from: 'mara', date: '2026-11-04' });
  fb.write('leo four', { from: 'leo', date: '2026-11-04' });
  assert.deepEqual(fb.list(), ['2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'], 'CONTROL: the plain list has every agent\'s days');
  assert.deepEqual(fb.mineLines('mara'), ['2026-11-03', '2026-11-01'], 'a blank section is not a report (11-04 left out)');
  assert.deepEqual(fb.mineLines('LEO'), ['2026-11-04', '2026-11-03', '2026-11-02']);
  assert.deepEqual(fb.mineLines('kip'), [fb.noneOfYoursWords()]);
  assert.match(fb.noneOfYoursWords(), /^None of the days on this computer holds a report of yours yet/);
});

test('listNote names --mine only when the list holds other agents\' days too', () => {
  fresh();
  fb.write('mara one', { from: 'mara', date: '2026-11-01' });
  assert.equal(fb.listNote('mara'), 'These are the days with a report on this computer, from every agent here. 1 of them holds yours: 2026-11-01.', 'every day is yours: no hint');
  fb.write('leo two', { from: 'leo', date: '2026-11-02' });
  assert.equal(fb.listNote('mara'), 'These are the days with a report on this computer, from every agent here. 1 of them holds yours: 2026-11-01. To list only yours: kosmos feedback list --mine');
  assert.doesNotMatch(fb.listNote('kip'), /--mine/, 'none of yours: the note already says so, and --mine would print only that');
});
