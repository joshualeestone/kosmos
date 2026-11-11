'use strict';
/*
 * kosmos#7886 item 6: engine/feedback.unchanged(), the body behind `kosmos feedback write --unchanged`, on a throwaway
 * store with NAMED writers (the CLI tests run as the unnamed one). The store's folder is read when it is required, so
 * the data folder is set before the first require.
 */
require('../test-support/tmpscope');   // this process's temp folders, removed when it exits
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
  // kosmos#8269: the refusal also names the newest earlier day holding another writer's report, so the CLI can say whose.
  assert.deepEqual(fb.unchanged('leo', '', TODAY), { ok: false, why: 'none', newest: '2026-11-01' });
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
  assert.deepEqual(u, { ok: true, since: '2026-10-30', day: TODAY, body: 'Nothing new since my report of 2026-10-30, except: one thing' });
});

test('a report already saved today is refused, so --unchanged never replaces it', () => {
  fresh();
  fb.write('yesterday', { from: 'leo', date: '2026-11-02' });
  fb.write('today\'s real findings', { from: 'leo', date: TODAY });
  assert.deepEqual(fb.unchanged('leo', '', TODAY), { ok: false, why: 'today' });
  assert.equal(fb.unchanged('mara', '', TODAY).why, 'none', 'CONTROL: another writer is not blocked by leo\'s report');
});

test('a bare earlier pointer is followed to the report it names; one with a line added is pointed at', () => {
  fresh();
  fb.write('the real report', { from: 'leo', date: '2026-10-30' });
  fb.write(fb.unchanged('leo', '', '2026-10-31').body, { from: 'leo', date: '2026-10-31' });
  const bare = fb.unchanged('leo', '', '2026-11-01');
  assert.equal(bare.since, '2026-10-30', 'a bare pointer was pointed at instead of followed: ' + bare.body);
  fb.write(fb.unchanged('leo', 'one new thing', '2026-11-01').body, { from: 'leo', date: '2026-11-01' });
  const u = fb.unchanged('leo', '', TODAY);
  assert.equal(u.since, '2026-11-01', 'a pointer that carried a new line was skipped: ' + u.body);
});

test('the same pointer again is allowed (a send that failed says to write it again); a different note is refused', () => {
  fresh();
  fb.write('the real report', { from: 'leo', date: '2026-11-01' });
  const first = fb.unchanged('leo', 'one thing', TODAY);
  fb.write(first.body, { from: 'leo', date: TODAY });
  const again = fb.unchanged('leo', 'one thing', TODAY);
  assert.equal(again.ok, true, 'retrying the same --unchanged was refused');
  assert.equal(again.body, first.body);
  assert.equal(fb.unchanged('leo', 'another thing', TODAY).why, 'today', 'a different --unchanged replaced today\'s report');
});
