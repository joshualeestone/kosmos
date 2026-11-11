'use strict';
/*
 * kosmos#8340 item 1: `kosmos feedback list` says whose reports its dates are, and which hold the asking agent's own
 * (engine/feedback.daysOf, listNote), on a throwaway store with NAMED writers.
 */
require('../test-support/tmpscope');   // this process's temp folders, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fblist-8340-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');

function fresh() { fs.rmSync(fb.dir(), { recursive: true, force: true }); }

test('CONTROL: the store is the throwaway folder', () => {
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

test('daysOf: only days holding a non-blank section by this writer, matched without case, newest first', () => {
  fresh();
  fb.write('mara saw a bug', { from: 'mara', date: '2026-11-01' });
  fb.write('leo one', { from: 'Leo', date: '2026-11-02' });
  fb.write('mara again', { from: 'mara', date: '2026-11-03' });
  fb.write('   ', { from: 'leo', date: '2026-11-03' });
  fb.write('leo three', { from: 'leo', date: '2026-11-04' });
  assert.deepEqual(fb.list(), ['2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'], 'CONTROL: the computer lists every day');
  assert.deepEqual(fb.daysOf('LEO'), ['2026-11-04', '2026-11-02']);
  assert.deepEqual(fb.daysOf('mara'), ['2026-11-03', '2026-11-01']);
  assert.deepEqual(fb.daysOf('kip'), []);
});

test('listNote: says the days are every agent\'s, and how many are yours; none of yours names the --unchanged refusal', () => {
  fresh();
  assert.equal(fb.listNote('mara'), null, 'an empty store gets no note');
  fb.write('mara saw a bug', { from: 'mara', date: '2026-11-01' });
  assert.equal(fb.listNote('mara'), 'These are the days with a report on this computer, from every agent here. 1 of them holds yours: 2026-11-01.');
  fb.write('mara again', { from: 'mara', date: '2026-11-03' });
  assert.equal(fb.listNote('mara'), 'These are the days with a report on this computer, from every agent here. 2 of them hold yours, the newest 2026-11-03.');
  const kip = fb.listNote('kip');
  assert.match(kip, /^These are the days with a report on this computer, from every agent here\. None of them holds one of yours yet/);
  assert.match(kip, /feedback write --unchanged/);
  assert.deepEqual(fb.unchanged('kip', '', '2026-11-09'), { ok: false, why: 'none', newest: '2026-11-03' }, 'CONTROL: the refusal the note warns about is real (kosmos#8269: naming mara\'s newest day)');
});
