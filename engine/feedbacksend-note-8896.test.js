'use strict';
/*
 * kosmos#8896, #8900: after a note on an EARLIER day, `kosmos feedback note` queues that day (feedbacksend's `pending`
 * list) and the board's hourly check sends it once, without moving the one-day send record. This file checks the
 * sentence the command prints against what the hourly check actually sends, through a stub sender.
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbnote-send-'));
process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'http://127.0.0.1:9/api/feedback';   // loopback only, and stubbed below
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');
const fbs = require('./feedbacksend');

const NOW = new Date(2026, 10, 22, 12, 0).getTime();   // local noon, so "yesterday" is unambiguous
const TODAY = fb.dateKey(new Date(NOW));
const YESTERDAY = fb.dateKey(new Date(2026, 10, 21, 12, 0));
const OLDER = fb.dateKey(new Date(2026, 10, 18, 12, 0));

function fresh() {
  fs.rmSync(fb.dir(), { recursive: true, force: true });
  fs.rmSync(fbs.FILE, { force: true });
  fbs.setOn(true);
}
function stub() {
  const posts = [];
  fbs.setSender(async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, status: 200 }; });
  return posts;
}
const settle = () => new Promise((r) => setTimeout(r, 50));
/* Days Kosmos has started sending (markSent records them), the newest last: only those can be queued (#8900 review 2). */
function offer(...days) { for (const d of days) fbs.markSent(d, 'h-' + d, NOW - 6 * 3600 * 1000); }

test('CONTROL: the send record and the reports are in the throwaway folder', () => {
  assert.ok(fbs.FILE.startsWith(process.env.AGENT_WORKFORCE_DATA), fbs.FILE);
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

const record = () => { const r = fbs.read(); return { sent: r.sent, sentHash: r.sentHash, sentAt: r.sentAt }; };
const has = (posts, text) => posts.some((p) => JSON.stringify(p).includes(text));
const HOURLY = /^Added the note to your report of \d{4}-\d{2}-\d{2}, on this computer\. The changed report goes to the Kosmos team on one of Kosmos's hourly checks while it is running \(tried up to three times; switching sending off cancels it\), with home paths and the names and keys Kosmos recognises taken out first\.$/;

test('kosmos#8900: an OLDER day (not the last one sent) is queued, sent on the next hourly check, and the one-day record is untouched', async () => {
  fresh();
  const posts = stub();
  fb.write('an older report', { from: 'mara', date: OLDER });
  offer(OLDER, YESTERDAY);   // OLDER was sent once; no report for yesterday here, so the sweep's own resend skips it
  const before = record();
  assert.equal(fb.note('mara', 'OLD correction', OLDER, NOW).ok, true);
  assert.match(fbs.noteEarlierDay(OLDER, NOW), HOURLY);
  assert.deepEqual(fbs.read().pending, [{ date: OLDER, tries: 0 }]);
  fbs.sweepTick(NOW);
  await settle();
  assert.ok(has(posts, 'OLD correction'), 'the sentence said it goes, and the hourly check did not send it: ' + JSON.stringify(posts));
  const sentOne = posts.find((p) => JSON.stringify(p).includes('OLD correction'));
  assert.equal(sentOne.date, OLDER, 'it was sent as some other day');
  assert.deepEqual(fbs.read().pending, [], 'an accepted correction stayed queued');
  assert.deepEqual(record(), before, 'sending a correction moved today\'s send record');
});

test('kosmos#8900 review 2: YESTERDAY as the last day sent is queued, and the hourly check sends it exactly once (its own resend steps aside)', async () => {
  fresh();
  const posts = stub();
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  offer(YESTERDAY);
  assert.equal(fb.note('mara', 'Y correction', YESTERDAY, NOW).ok, true);
  assert.match(fbs.noteEarlierDay(YESTERDAY, NOW), HOURLY);
  assert.deepEqual(fbs.read().pending, [{ date: YESTERDAY, tries: 0 }]);
  fbs.sweepTick(NOW);
  await settle();
  assert.equal(posts.filter((p) => JSON.stringify(p).includes('Y correction')).length, 1, JSON.stringify(posts.map((p) => p.date)));
  assert.deepEqual(fbs.read().pending, []);
});

test('kosmos#8900 review 2: a later day\'s send that goes FIRST does not flush a queued day, so it still goes exactly once', async () => {
  fresh();
  const posts = stub();
  fb.write('an older report', { from: 'mara', date: OLDER });
  offer(OLDER);   // OLDER is the record's day
  fb.note('mara', 'FLUSH-FIRST correction', OLDER, NOW);
  fbs.noteEarlierDay(OLDER, NOW);
  fb.write('today\'s report', { from: 'mara', date: TODAY });
  await fbs.sendNow(TODAY, NOW);   // the later day goes first: flushChangedDay must leave the queued OLDER to the drain
  await settle();
  assert.equal(posts.filter((p) => JSON.stringify(p).includes('FLUSH-FIRST correction')).length, 0, 'the flush sent a queued day');
  fbs.sweepTick(NOW + 3600 * 1000);
  await settle();
  assert.equal(posts.filter((p) => JSON.stringify(p).includes('FLUSH-FIRST correction')).length, 1, JSON.stringify(posts.map((p) => p.date)));
});

test('kosmos#8900 review 2: a note added while the day\'s send is in flight keeps the day queued, so the new note goes too', async () => {
  fresh();
  const posts = [];
  let first = true;
  fbs.setSender(async (url, init) => {
    posts.push(JSON.parse(init.body));
    if (first) { first = false; fb.note('mara', 'SECOND note', OLDER, NOW + 1000); }   // lands before this send answers
    return { ok: true, status: 200 };
  });
  fb.write('an older report', { from: 'mara', date: OLDER });
  offer(OLDER, YESTERDAY);
  fb.note('mara', 'FIRST note', OLDER, NOW);
  fbs.noteEarlierDay(OLDER, NOW);
  fbs.sweepTick(NOW);
  await settle();
  assert.equal(fbs.read().pending.length, 1, 'the day was dropped although its report changed during the send');
  fbs.sweepTick(NOW + 3600 * 1000);
  await settle();
  assert.ok(posts.some((p) => JSON.stringify(p).includes('SECOND note')), 'the second note never went');
  assert.deepEqual(fbs.read().pending, []);
});

test('kosmos#8900 review 1: an OLDER day that is the last one sent goes on the hourly check, and a later day\'s send does not send it again', async () => {
  fresh();
  const posts = stub();
  fb.write('an older report', { from: 'mara', date: OLDER });
  fbs.markSent(OLDER, 'hash-of-the-sent-version', NOW - 6 * 3600 * 1000);
  assert.equal(fb.note('mara', 'LAST-SENT correction', OLDER, NOW).ok, true);
  assert.match(fbs.noteEarlierDay(OLDER, NOW), HOURLY);
  fbs.sweepTick(NOW);   // no report today and OLDER is not yesterday: only the correction can send it
  await settle();
  assert.equal(posts.filter((p) => JSON.stringify(p).includes('LAST-SENT correction')).length, 1, JSON.stringify(posts));
  fb.write('today\'s report', { from: 'mara', date: TODAY });
  await fbs.sendNow(TODAY, NOW + 2 * 60 * 1000);   // a later day goes: flushChangedDay must find OLDER already delivered
  await settle();
  assert.equal(posts.filter((p) => JSON.stringify(p).includes('LAST-SENT correction')).length, 1, 'the later day\'s send sent the corrected day again');
});

test('kosmos#8900 review 2: a day Kosmos never started sending is not queued, even one before the last day sent: the note stays here', () => {
  fresh();
  const STAYS = /Kosmos has no record of sending that day, so this note stays on this computer\.$/;
  assert.match(fbs.noteEarlierDay(OLDER, NOW), STAYS, 'nothing ever sent');
  offer(YESTERDAY);   // a later day was sent, but OLDER never was (sending was off that day, say)
  assert.match(fbs.noteEarlierDay(OLDER, NOW), STAYS, 'a day before the last one sent, never itself sent');
  assert.deepEqual(fbs.read().pending, []);
  offer(OLDER, YESTERDAY);
  assert.match(fbs.noteEarlierDay(OLDER, NOW), HOURLY, 'CONTROL: once OLDER was offered, the same note is queued');
});

test('kosmos#8900 review 6: as the real command does it (note, then noteEarlierDay) during the THIRD try, the new note still goes', async () => {
  fresh();
  const posts = [];
  let tick = 0;
  fbs.setSender(async (url, init) => {
    posts.push(JSON.parse(init.body));
    if (tick === 3) { fb.note('mara', 'LATE note', OLDER, NOW + 3 * 3600 * 1000 + 1000); fbs.noteEarlierDay(OLDER, NOW + 3 * 3600 * 1000 + 1000); return { ok: true, status: 200 }; }
    return { ok: false, status: 503 };   // the first two tries are refused
  });
  fb.write('an older report', { from: 'mara', date: OLDER });
  offer(OLDER, YESTERDAY);
  fb.note('mara', 'FIRST note', OLDER, NOW);
  fbs.noteEarlierDay(OLDER, NOW);
  for (tick = 1; tick <= 3; tick++) { fbs.sweepTick(NOW + tick * 3600 * 1000); await settle(); }
  assert.equal(fbs.read().pending.length, 1, 'the day was dropped although a note landed during its third try');
  for (tick = 4; tick <= 6; tick++) { fbs.sweepTick(NOW + tick * 3600 * 1000); await settle(); }
  assert.ok(posts.some((p) => JSON.stringify(p).includes('LATE note')), 'the note added during the third try never went');
});

test('kosmos#8900: one queued day per hourly check, in the order they were queued', async () => {
  fresh();
  const posts = stub();
  offer('2026-11-15', '2026-11-16', YESTERDAY);
  for (const d of ['2026-11-15', '2026-11-16']) { fb.write('report ' + d, { from: 'mara', date: d }); fb.note('mara', 'fix ' + d, d, NOW); fbs.noteEarlierDay(d, NOW); }
  fbs.sweepTick(NOW);
  await settle();
  assert.ok(has(posts, 'fix 2026-11-15') && !has(posts, 'fix 2026-11-16'), 'more than one day went in one check: ' + JSON.stringify(posts.map((p) => p.date)));
  fbs.sweepTick(NOW + 3600 * 1000);
  await settle();
  assert.ok(has(posts, 'fix 2026-11-16'), 'the second day never went');
  assert.deepEqual(fbs.read().pending, []);
});

test('kosmos#8900: a collector that refuses uses up three tries, then the day is dropped; the record never moves', async () => {
  fresh();
  const posts = [];
  fbs.setSender(async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: false, status: 503 }; });
  offer(OLDER, YESTERDAY);
  fb.write('an older report', { from: 'mara', date: OLDER });
  fb.note('mara', 'REFUSED correction', OLDER, NOW);
  fbs.noteEarlierDay(OLDER, NOW);
  const before = record();
  for (let i = 1; i <= 3; i++) {
    fbs.sweepTick(NOW + i * 3600 * 1000);
    await settle();
    assert.deepEqual(fbs.read().pending.map((x) => ({ date: x.date, tries: x.tries })), [{ date: OLDER, tries: i }], 'try ' + i);
    assert.match(fbs.read().pending[0].h, /^[0-9a-f]{64}$/, 'the try did not record the hash it sent');
  }
  fbs.sweepTick(NOW + 4 * 3600 * 1000);
  await settle();
  assert.deepEqual(fbs.read().pending, [], 'a day was kept past three tries');
  assert.equal(posts.filter((p) => p.date === OLDER).length, 3, 'not exactly three tries were sent');
  assert.deepEqual(record(), before);
});

test('kosmos#8900 review 3: a queued YESTERDAY that the collector keeps refusing is tried exactly three times, not resent by the sweep after', async () => {
  fresh();
  const posts = [];
  fbs.setSender(async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: false, status: 503 }; });
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  offer(YESTERDAY);
  fb.note('mara', 'REFUSED yesterday', YESTERDAY, NOW);
  fbs.noteEarlierDay(YESTERDAY, NOW);
  // Hourly checks from noon to 23:00 the same day, so "yesterday" stays YESTERDAY for the sweep's own resend, and the
  // three-hour floor passes several times after the third try.
  for (let i = 1; i <= 11; i++) { fbs.sweepTick(NOW + i * 3600 * 1000); await settle(); }
  assert.equal(fb.dateKey(new Date(NOW + 11 * 3600 * 1000)), TODAY, 'CONTROL: every check ran on the same day');
  assert.equal(posts.filter((p) => p.date === YESTERDAY).length, 3, 'tries for yesterday: ' + posts.filter((p) => p.date === YESTERDAY).length);
  assert.deepEqual(fbs.read().pending, []);
});

test('kosmos#8900 review 4: a rewrite of the record\'s day AFTER its last refused try is still a change, and still goes', async () => {
  fresh();
  let refuse = true;
  const posts = [];
  fbs.setSender(async (url, init) => { posts.push(JSON.parse(init.body)); return refuse ? { ok: false, status: 503 } : { ok: true, status: 200 }; });
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  offer(YESTERDAY);
  fb.note('mara', 'refused note', YESTERDAY, NOW);
  fbs.noteEarlierDay(YESTERDAY, NOW);
  for (let i = 1; i <= 3; i++) { fbs.sweepTick(NOW + i * 3600 * 1000); await settle(); }   // three refused tries
  fb.write('REWRITTEN after the tries', { from: 'mara', date: YESTERDAY });   // a genuinely new version of the day
  refuse = false;
  for (let i = 4; i <= 11; i++) { fbs.sweepTick(NOW + i * 3600 * 1000); await settle(); }   // the drop, then later checks the same day
  assert.ok(posts.some((p) => JSON.stringify(p).includes('REWRITTEN after the tries')), 'the rewrite after the last try was marked handled and never sent');
});

/* Behaviour only: when today is marked BEFORE the drop's check, the check already sees today and never marks the old
   day. The review 7 guard inside the write covers today being marked BETWEEN that check and the write, which this file
   cannot interleave; that guard is reasoned from the code, not proven here (a mutation removing it stays green). */
test('kosmos#8900 review 7: a used-up day whose record moved on before the check leaves today\'s hash alone', async () => {
  fresh();
  fbs.setSender(async () => ({ ok: false, status: 503 }));
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  offer(YESTERDAY);
  fb.note('mara', 'note', YESTERDAY, NOW);
  fbs.noteEarlierDay(YESTERDAY, NOW);
  for (let i = 1; i <= 3; i++) { fbs.sweepTick(NOW + i * 3600 * 1000); await settle(); }   // three refused tries
  fbs.markSent(TODAY, 'today-hash', NOW + 3 * 3600 * 1000 + 1000);   // today is marked before the drop
  fbs.sweepTick(NOW + 4 * 3600 * 1000);   // the drop of the used-up yesterday
  await settle();
  assert.equal(fbs.read().sent, TODAY);
  assert.equal(fbs.read().sentHash, 'today-hash', 'today\'s hash was overwritten with yesterday\'s');
});

test('kosmos#8900 review 3: a file from before the offered list: a day it never recorded says "no record", not "not sent"', () => {
  fresh();
  fs.writeFileSync(fbs.FILE, JSON.stringify({ on: true, sent: YESTERDAY, sentHash: 'h', sentAt: NOW - 3600 * 1000 }) + '\n');
  assert.match(fbs.noteEarlierDay(OLDER, NOW), /Kosmos has no record of sending that day, so this note stays on this computer\.$/);
  assert.doesNotMatch(fbs.noteEarlierDay(OLDER, NOW), /has not sent/);
  assert.match(fbs.noteEarlierDay(YESTERDAY, NOW), HOURLY, 'CONTROL: the record\'s own day is still queued from an old file');
});

test('kosmos#8900 review 5: a queued day that is not before today by the clock (set back) is not drained', async () => {
  fresh();
  const posts = stub();
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  offer(YESTERDAY);
  fb.note('mara', 'CLOCK note', YESTERDAY, NOW);
  fbs.noteEarlierDay(YESTERDAY, NOW);
  const back = new Date(2026, 10, 21, 15, 0).getTime();   // the clock now reads YESTERDAY afternoon
  fbs.sweepTick(back);
  await settle();
  // The normal daily send may post that day (it is "today" now); the queue must not count a try on it or drop it.
  assert.deepEqual(fbs.read().pending.map((x) => ({ date: x.date, tries: x.tries })), [{ date: YESTERDAY, tries: 0 }], 'the drain tried a day that is today by the clock');
  void posts;
});

test('kosmos#8900: switching sending off cancels the queue at once, so switching it back on sends nothing queued before', async () => {
  fresh();
  const posts = stub();
  offer(OLDER, YESTERDAY);
  fb.write('an older report', { from: 'mara', date: OLDER });
  fb.note('mara', 'OFF correction', OLDER, NOW);
  fbs.noteEarlierDay(OLDER, NOW);
  assert.equal(fbs.read().pending.length, 1);
  fbs.setOn(false);
  assert.deepEqual(fbs.read().pending, [], 'review 1: switching off must cancel the queue at once, not at the next check');
  fbs.setOn(true);   // back on before any check ran
  fbs.sweepTick(NOW);
  await settle();
  assert.deepEqual(fbs.read().pending, []);
  fbs.setOn(true);
  fbs.sweepTick(NOW + 3600 * 1000);
  await settle();
  assert.ok(!has(posts, 'OFF correction'), 'a correction queued before sending went off was sent after it came back on');
});

test('kosmos#8900: the queue survives the other writes (setOn, markSent), is capped, and refuses today, a future or a bad date', () => {
  fresh();
  const octo = Array.from({ length: fbs.PENDING_MAX + 2 }, (_, i) => '2026-10-' + String(i + 1).padStart(2, '0'));
  offer(...octo, OLDER, YESTERDAY);
  fbs.queueCorrection(OLDER, NOW);
  fbs.setOn(true);
  fbs.markSent(YESTERDAY, 'h2', NOW);
  assert.ok(fbs.read().offered.includes(OLDER), 'markSent dropped the days already offered');
  assert.deepEqual(fbs.read().pending, [{ date: OLDER, tries: 0 }], 'a partial write wiped the queue');
  const results = octo.map((d) => fbs.queueCorrection(d, NOW));
  const q = fbs.read().pending;
  assert.equal(q.length, fbs.PENDING_MAX);
  // Review 5: a full list refuses the new day; the days already told they go are kept.
  assert.equal(q[0].date, OLDER, 'a day already promised was dropped to make room');
  assert.deepEqual(results.slice(-3).map((r) => r.why || 'ok'), ['full', 'full', 'full']);
  assert.match(fbs.noteEarlierDay(octo[octo.length - 1], NOW), new RegExp('already has ' + fbs.PENDING_MAX + ' earlier days waiting to be sent, so this note stays on this computer\\.$'));
  assert.deepEqual(fbs.queueCorrection(TODAY, NOW), { ok: false, why: 'date' });
  assert.deepEqual(fbs.queueCorrection('2099-01-01', NOW), { ok: false, why: 'date' });
  assert.deepEqual(fbs.queueCorrection('../x', NOW), { ok: false, why: 'date' });
});

test('a test run (data in a temp folder, no injected sender): not sent, and nothing queued', () => {
  fresh();
  offer(OLDER);   // review 5: so a queue would accept the day, and the empty-queue check below can fail
  fbs.setSender(null);
  process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'https://installkosmos.com/api/feedback';   // a real address: only a stub may post
  try {
    assert.match(fbs.noteEarlierDay(OLDER, NOW), /Not sent: this is a test run \(or its data is in a temporary folder\)\.$/);
    assert.deepEqual(fbs.read().pending, []);
  } finally { process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'http://127.0.0.1:9/api/feedback'; }
});

test('sending switched off: the sentence says it will not be sent, and nothing is queued', () => {
  fresh();
  offer(OLDER);   // review 5: as above
  fbs.setOn(false);
  assert.match(fbs.noteEarlierDay(OLDER, NOW), /switched off \(Settings, Automation\), so it will not be sent\.$/);
  assert.deepEqual(fbs.read().pending, []);
});

test('NOTE_MESSAGES never tell an agent to write the report again (that would replace the note)', () => {
  for (const [state, s] of Object.entries(fbs.NOTE_MESSAGES)) assert.doesNotMatch(s, /kosmos feedback write|write the same report again|write it again/, state);
  assert.equal(TODAY > YESTERDAY, true, 'CONTROL: the days are in order');
});

test.after(() => fbs.setSender(null));
