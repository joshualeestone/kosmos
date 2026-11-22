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
  fbs.markSent(YESTERDAY, 'h-yesterday', NOW - 6 * 3600 * 1000);   // no report for yesterday here, so the sweep's own resend skips it
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

test('kosmos#8900 review 1: YESTERDAY as the last day sent is not queued (the hourly check re-sends it) and goes exactly once', async () => {
  fresh();
  const posts = stub();
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  fbs.markSent(YESTERDAY, 'hash-of-the-sent-version', NOW - 6 * 3600 * 1000);
  assert.equal(fb.note('mara', 'Y correction', YESTERDAY, NOW).ok, true);
  assert.match(fbs.noteEarlierDay(YESTERDAY, NOW), /That day is the last one Kosmos sent, so the changed report goes to the Kosmos team again on one of Kosmos's hourly checks/);
  assert.deepEqual(fbs.read().pending, [], 'yesterday was queued as well as left to the hourly check');
  fbs.sweepTick(NOW);
  await settle();
  assert.equal(posts.filter((p) => JSON.stringify(p).includes('Y correction')).length, 1, JSON.stringify(posts.map((p) => p.date)));
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

test('kosmos#8900 review 1: a day after the last one sent (or with nothing ever sent) is not queued: the note stays here', () => {
  fresh();
  assert.match(fbs.noteEarlierDay(OLDER, NOW), /Kosmos has not sent a report for that day or any later one, so it does not send that day now, and the note stays here\.$/);
  fbs.markSent(OLDER, 'h', NOW - 6 * 3600 * 1000);
  assert.match(fbs.noteEarlierDay(YESTERDAY, NOW), /has not sent a report for that day or any later one/);
  assert.deepEqual(fbs.read().pending, []);
});

test('kosmos#8900: one queued day per hourly check, in the order they were queued', async () => {
  fresh();
  const posts = stub();
  fbs.markSent(YESTERDAY, 'h', NOW - 6 * 3600 * 1000);
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
  fbs.markSent(YESTERDAY, 'h', NOW - 6 * 3600 * 1000);
  fb.write('an older report', { from: 'mara', date: OLDER });
  fb.note('mara', 'REFUSED correction', OLDER, NOW);
  fbs.noteEarlierDay(OLDER, NOW);
  const before = record();
  for (let i = 1; i <= 3; i++) {
    fbs.sweepTick(NOW + i * 3600 * 1000);
    await settle();
    assert.deepEqual(fbs.read().pending, [{ date: OLDER, tries: i }], 'try ' + i);
  }
  fbs.sweepTick(NOW + 4 * 3600 * 1000);
  await settle();
  assert.deepEqual(fbs.read().pending, [], 'a day was kept past three tries');
  assert.equal(posts.filter((p) => p.date === OLDER).length, 3, 'not exactly three tries were sent');
  assert.deepEqual(record(), before);
});

test('kosmos#8900: switching sending off cancels the queue at once, so switching it back on sends nothing queued before', async () => {
  fresh();
  const posts = stub();
  fbs.markSent(YESTERDAY, 'h', NOW - 6 * 3600 * 1000);
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
  fbs.markSent(YESTERDAY, 'h', NOW);
  fbs.queueCorrection(OLDER, NOW);
  fbs.setOn(true);
  fbs.markSent(YESTERDAY, 'h2', NOW);
  assert.deepEqual(fbs.read().pending, [{ date: OLDER, tries: 0 }], 'a partial write wiped the queue');
  for (let i = 1; i <= fbs.PENDING_MAX + 2; i++) fbs.queueCorrection('2026-10-' + String(i).padStart(2, '0'), NOW);
  const q = fbs.read().pending;
  assert.equal(q.length, fbs.PENDING_MAX);
  assert.equal(q[q.length - 1].date, '2026-10-' + String(fbs.PENDING_MAX + 2).padStart(2, '0'), 'the newest day was dropped instead of the oldest');
  assert.deepEqual(fbs.queueCorrection(TODAY, NOW), { ok: false, why: 'date' });
  assert.deepEqual(fbs.queueCorrection('2099-01-01', NOW), { ok: false, why: 'date' });
  assert.deepEqual(fbs.queueCorrection('../x', NOW), { ok: false, why: 'date' });
});

test('a test run (data in a temp folder, no injected sender): not sent, and nothing queued', () => {
  fresh();
  fbs.setSender(null);
  process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'https://installkosmos.com/api/feedback';   // a real address: only a stub may post
  try {
    assert.match(fbs.noteEarlierDay(OLDER, NOW), /Not sent: this is a test run \(or its data is in a temporary folder\)\.$/);
    assert.deepEqual(fbs.read().pending, []);
  } finally { process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'http://127.0.0.1:9/api/feedback'; }
});

test('sending switched off: the sentence says it will not be sent, and nothing is queued', () => {
  fresh();
  fbs.setOn(false);
  assert.match(fbs.noteEarlierDay(OLDER, NOW), /switched off \(Settings, Automation\), so it will not be sent\.$/);
  assert.deepEqual(fbs.read().pending, []);
});

test('NOTE_MESSAGES never tell an agent to write the report again (that would replace the note)', () => {
  for (const [state, s] of Object.entries(fbs.NOTE_MESSAGES)) assert.doesNotMatch(s, /kosmos feedback write|write the same report again|write it again/, state);
  assert.equal(TODAY > YESTERDAY, true, 'CONTROL: the days are in order');
});

test.after(() => fbs.setSender(null));
