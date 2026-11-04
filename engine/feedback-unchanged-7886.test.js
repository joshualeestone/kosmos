'use strict';
/*
 * kosmos#7886 item 6: engine/feedback.unchanged(), the body behind `kosmos feedback write --unchanged`, on a throwaway
 * store with NAMED writers (the CLI tests run as the unnamed one). The store's folder is read when it is required, so
 * the data folder is set before the first require.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbunch-engine-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');

function fresh() { fs.rmSync(fb.dir(), { recursive: true, force: true }); }
const TODAY = '2026-11-03';

test('CONTROL: the store is the throwaway folder', () => {
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

test('another writer\'s report is never claimed: a day holding only theirs is refused', () => {
  fresh();
  fb.write('mara saw a bug', { from: 'mara', date: '2026-11-01' });
  assert.deepEqual(fb.unchanged('leo', '', TODAY), { ok: false, why: 'none' });
  const mine = fb.unchanged('mara', '', TODAY);   // CONTROL: the same day is found for its own writer
  assert.equal(mine.ok, true);
  assert.equal(mine.since, '2026-11-01');
});

test('the newest earlier report is chosen, the writer is matched without case, and a blank section is skipped', () => {
  fresh();
  fb.write('first', { from: 'Leo', date: '2026-10-28' });
  fb.write('second', { from: 'leo', date: '2026-10-30' });
  fb.write('   ', { from: 'leo', date: '2026-11-01' });
  const u = fb.unchanged('LEO', 'one thing', TODAY);
  assert.deepEqual(u, { ok: true, since: '2026-10-30', day: TODAY, body: 'Nothing new since my report of 2026-10-30. one thing' });
});

test('a report already saved today is refused, so --unchanged never replaces it', () => {
  fresh();
  fb.write('yesterday', { from: 'leo', date: '2026-11-02' });
  fb.write('today\'s real findings', { from: 'leo', date: TODAY });
  assert.deepEqual(fb.unchanged('leo', '', TODAY), { ok: false, why: 'today' });
  assert.equal(fb.unchanged('mara', '', TODAY).why, 'none', 'CONTROL: another writer is not blocked by leo\'s report');
});

test('an earlier pointer is followed to the report it names', () => {
  fresh();
  fb.write('the real report', { from: 'leo', date: '2026-10-30' });
  fb.write(fb.unchanged('leo', '', '2026-10-31').body, { from: 'leo', date: '2026-10-31' });
  fb.write(fb.unchanged('leo', 'still nothing', '2026-11-01').body, { from: 'leo', date: '2026-11-01' });
  const u = fb.unchanged('leo', '', TODAY);
  assert.equal(u.since, '2026-10-30', 'a pointer pointed at a pointer: ' + u.body);
});
