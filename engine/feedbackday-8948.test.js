'use strict';
/* kosmos#8948 part 3: `kosmos feedback day` sees one calendar day, so a session resumed across days (an account switch)
   read "nothing today" while its work sat on an earlier day. Now `--date YYYY-MM-DD` reads that day, an empty today
   points to it, and a task file written again since that day is still read for it.
   node --test engine/feedbackday-8948.test.js */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const day = require('./feedbackday');
const fb = require('./feedback');

const seams = { listTaskFiles: () => [], readTask: () => [], isGuide: () => false, replyChannel: () => null };

test('kosmos#8948: dayArg takes nothing (today) or --date with a real day not after today', () => {
  const now = new Date(2026, 10, 23, 12, 0).getTime();
  assert.deepEqual(day.dayArg([], now), { date: null });
  assert.deepEqual(day.dayArg(['--date', '2026-11-21'], now), { date: '2026-11-21' });
  assert.deepEqual(day.dayArg(['--date', '2026-11-23'], now), { date: '2026-11-23' }, 'today itself is a day');
  assert.ok(day.dayArg(['--date', '2026-11-24'], now).error, 'CONTROL: a day after today was taken');
  assert.ok(day.dayArg(['--date', '2026-02-30'], now).error, 'CONTROL: a day that does not exist was taken');
  assert.equal(day.dayArg(['--date'], now).usage, true, 'CONTROL: --date with no day');
  assert.equal(day.dayArg(['2026-11-21'], now).usage, true, 'CONTROL: a bare day, not --date');
  assert.equal(day.dayBefore('2026-03-01', fb.dateKey), '2026-02-28');
  assert.equal(day.dayBefore('2026-01-01', fb.dateKey), '2025-12-31');
});

test('kosmos#8948: an earlier day is named as that day, not "today"', () => {
  const out = day.digest({ name: 'Dana', date: '2026-11-21', asked: true, readThread: () => [], ...seams }).join('\n');
  assert.match(out, /Your day on this computer, 2026-11-21/);
  assert.match(out, /nothing on 2026-11-21\./);
  assert.match(out, /Tasks you changed on 2026-11-21: none\./);
  assert.doesNotMatch(out, /\btoday\b/, 'an earlier day still says today');
  assert.doesNotMatch(out, /Nothing here today/, 'CONTROL: the pointer is only for today');
});

test('kosmos#8948: an empty today points to the day before; a today with anything in it does not', () => {
  // Review 1: digest reads its own today, so a run that crosses midnight checks nothing rather than reading red.
  const today = fb.today();
  const empty = day.digest({ name: 'Dana', readThread: () => [], ...seams }).join('\n');
  if (fb.today() !== today) return;
  assert.match(empty, new RegExp('Nothing here today\\. If this session began on an earlier day, read that day too: kosmos feedback day --date ' + day.dayBefore(today, fb.dateKey)));
  const said = [{ from: 'Dana', text: 'done', at: new Date().toISOString() }];
  const busy = day.digest({ name: 'Dana', readThread: () => said, ...seams }).join('\n');
  assert.match(busy, /in Kosmos today: 0 from them, 1 from you/, 'CONTROL: the fixture is a today with a message');
  assert.doesNotMatch(busy, /Nothing here today/, 'CONTROL: a today with a message still pointed elsewhere');
  const unread = day.digest({ name: 'Dana', readThread: () => { throw new Error('no'); }, ...seams }).join('\n');
  assert.doesNotMatch(unread, /Nothing here today/, 'CONTROL: a conversation that could not be read is not "nothing"');
});

test('kosmos#8948: a task file written again after the asked day is still read for that day', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-fbday8948-'));
  const f = path.join(dir, 'proj.task-7.jsonl');
  fs.writeFileSync(f, '');
  const before = new Date(2026, 10, 20, 12, 0);
  const after = new Date(2026, 10, 22, 12, 0);
  fs.utimesSync(f, after, after);   // last written two days after the day asked about
  assert.deepEqual(day.listTaskFilesIn(dir, fb.dateKey(before), fb.dateKey), ['proj.task-7.jsonl'], 'a file written since the asked day was skipped');
  fs.utimesSync(f, before, before);
  assert.deepEqual(day.listTaskFilesIn(dir, fb.dateKey(after), fb.dateKey), [], 'CONTROL: a file last written before the asked day was read');
});

/* Review 1: --date reaches the digest through the Windows CLI with the real dayArg, marked as asked for; a bad day is
   refused before the agent is even looked up. (Before this, only a stub without dayArg ran here.) */
test('kosmos#8948: the Windows CLI hands --date to the digest as an asked day, and refuses a bad one first', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  async function win(argv) {
    const seen = { who: 0, digest: null };
    const engine = { feedbackday: { dayArg: day.dayArg,
      recordWho: () => { seen.who += 1; return { name: 'dana', also: [] }; },
      digest: (o) => { seen.digest = o; return ['DAY']; } } };
    const out = []; const err = [];
    const code = await cli.main(argv, { env: {}, out: (x) => out.push(x), err: (x) => err.push(x), engine });
    return { code, err: err.join('\n'), seen };
  }
  const asked = await win(['feedback', 'day', '--date', '2026-11-21']);
  assert.equal(asked.code, 0, asked.err);
  assert.equal(asked.seen.digest.date, '2026-11-21', '--date did not reach the digest');
  assert.equal(asked.seen.digest.asked, true, 'the day was not marked as asked for, so it would read "today"');
  const plain = await win(['feedback', 'day']);
  assert.equal(plain.code, 0);
  assert.equal(plain.seen.digest.asked, undefined, 'CONTROL: a plain call was marked as an asked day');
  for (const bad of [['--date', '2099-01-01'], ['--date', 'soon'], ['--date'], ['more']]) {
    const r = await win(['feedback', 'day', ...bad]);
    assert.equal(r.code, 2, 'refused with the wrong code: ' + bad.join(' '));
    assert.equal(r.seen.who, 0, 'the agent was looked up before a bad argument was refused: ' + bad.join(' '));
  }
});
