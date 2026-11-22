'use strict';
/*
 * kosmos#8896 review 1: after a note on an EARLIER day, `kosmos feedback note` must say truthfully whether that day can
 * still leave the computer. The send record names ONE day, and while sending is on that day is sent again once its
 * report changes (sweepTick for yesterday, flushChangedDay when a later day goes). So the sentence is read from the
 * record, and this file checks it against what the sweep actually sends, through a stub sender.
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

test('the last day sent: the sentence says it goes with a later send, and the sweep does send the note', async () => {
  fresh();
  const posts = stub();
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  fbs.markSent(YESTERDAY, 'hash-of-the-sent-version', NOW - 6 * 3600 * 1000);
  assert.equal(fb.note('mara', 'SECRET correction', YESTERDAY, NOW).ok, true);
  assert.match(fbs.earlierNoteMessage(YESTERDAY, NOW), /^Added the note to your report of \d{4}-\d{2}-\d{2}, on this computer\. That day is the last one Kosmos sent, so the changed report goes to the Kosmos team again on one of Kosmos's hourly checks while it is running \(at most once every three hours\)/);
  fbs.sweepTick(NOW);
  await settle();
  assert.ok(posts.some((p) => JSON.stringify(p).includes('SECRET correction')), 'the sentence said it goes, and the sweep did not send it: ' + JSON.stringify(posts));
});

test('an older day, not the last one sent: the sentence says it stays, and the sweep does not send it', async () => {
  fresh();
  const posts = stub();
  fb.write('an older report', { from: 'mara', date: OLDER });
  fb.write('yesterday\'s report', { from: 'mara', date: YESTERDAY });
  fbs.markSent(YESTERDAY, null, NOW - 6 * 3600 * 1000);
  assert.equal(fb.note('mara', 'OLD correction', OLDER, NOW).ok, true);
  assert.match(fbs.earlierNoteMessage(OLDER, NOW), /Kosmos sends an earlier day only when it is the last day it sent, and this one is not, so this note stays here\.$/);
  fbs.sweepTick(NOW);
  await settle();
  assert.ok(!posts.some((p) => JSON.stringify(p).includes('OLD correction')), 'an older day\'s note was sent');
  assert.ok(posts.length > 0, 'CONTROL: the sweep sent something this tick, so the stub can see a send');
});

test('an OLDER day that is still the last one sent: the sweep does not send it; the next later day\'s send does, once', async () => {
  fresh();
  const posts = stub();
  fb.write('an older report', { from: 'mara', date: OLDER });
  fbs.markSent(OLDER, 'hash-of-the-sent-version', NOW - 6 * 3600 * 1000);
  assert.equal(fb.note('mara', 'OLDER correction', OLDER, NOW).ok, true);
  assert.match(fbs.earlierNoteMessage(OLDER, NOW), /That day is the last one Kosmos sent, so the changed report goes to the Kosmos team once, when a later day's report is next sent/);
  fbs.sweepTick(NOW);   // no report today, and OLDER is not yesterday: the hourly check sends nothing
  await settle();
  assert.ok(!posts.some((p) => JSON.stringify(p).includes('OLDER correction')), 'the hourly check sent an older day');
  fb.write('today\'s report', { from: 'mara', date: TODAY });
  await fbs.sendNow(TODAY, NOW);   // a later day's report goes: the older day is flushed with it
  await settle();
  assert.ok(posts.some((p) => JSON.stringify(p).includes('OLDER correction')), 'the sentence said the next later send takes it, and it did not: ' + JSON.stringify(posts));
});

test('sending switched off: the sentence says it will not be sent', () => {
  fresh();
  fbs.setOn(false);
  assert.match(fbs.earlierNoteMessage(YESTERDAY), /switched off \(Settings, Automation\), so it will not be sent\.$/);
});

test('NOTE_MESSAGES never tell an agent to write the report again (that would replace the note)', () => {
  for (const [state, s] of Object.entries(fbs.NOTE_MESSAGES)) assert.doesNotMatch(s, /kosmos feedback write(?! )|write the same report again/, state);
  assert.equal(TODAY > YESTERDAY, true, 'CONTROL: the days are in order');
});

test.after(() => fbs.setSender(null));
