'use strict';

/* kosmos#7875 item 1: `kosmos feedback day`, the asking agent's own day for its feedback report (engine/feedbackday.js).
   Readers are injected: no live store is read. Dates are built in local time, as feedback.dateKey reads them. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const day = require('./feedbackday');
const fb = require('./feedback');

const DATE = '2026-11-03';
const at = (h, m, d = 3) => new Date(2026, 10, d, h, m).toISOString();

function run(o) {
  return day.digest({ name: 'Dana', date: DATE, listTaskFiles: () => [], readTask: () => [], ...o });
}

test('#7875: today\'s conversation both ways, oldest first, as time, who and the first line', () => {
  const out = run({ readThread: () => [
    { at: at(14, 5), text: 'Second from them', from: null },
    { at: at(9, 30), text: 'Can you check the catalogue?\nMore detail below.', from: null },
    { at: at(9, 32), text: 'On it.', from: 'Dana' },
  ] });
  assert.ok(out.includes('Your conversation with your person today: 2 from them, 1 from you.'), out.join('\n'));
  const i = out.indexOf('  09:30 them: Can you check the catalogue?');
  assert.ok(i > 0, out.join('\n'));
  assert.equal(out[i + 1], '  09:32 you: On it.');
  assert.equal(out[i + 2], '  14:05 them: Second from them');
});

test('#7875: only today counts; another agent\'s message is not "you"', () => {
  const out = run({ readThread: () => [
    { at: at(23, 50, 2), text: 'Yesterday', from: null },
    { at: at(10, 0), text: 'Today', from: 'Eli' },
  ] });
  const text = out.join('\n');
  assert.ok(!text.includes('Yesterday'), text);
  assert.ok(text.includes('10:00 them: Today'), text);   // CONTROL: today's row is shown
});

test('#7875: an unreadable conversation says so, never "nothing today"', () => {
  const out = run({ readThread: () => { throw new Error('unreadable'); } }).join('\n');
  assert.ok(out.includes('Kosmos could not read it on this computer'), out);
  assert.ok(!out.includes('nothing today'), out);
  const empty = run({ readThread: () => [] }).join('\n');
  assert.ok(empty.includes('Your conversation with your person: nothing today.'), empty);   // CONTROL: empty is not unreadable
});

test('#7875: a long day keeps the newest messages and says it was cut', () => {
  const msgs = [];
  for (let i = 0; i < day.MAX_MESSAGES + 5; i++) msgs.push({ at: at(8 + Math.floor(i / 60), i % 60), text: 'm' + i, from: null });
  const out = run({ readThread: () => msgs });
  assert.ok(out.includes('  (the last ' + day.MAX_MESSAGES + ')'), out.join('\n'));
  assert.ok(out.some((l) => l.endsWith(': m' + (day.MAX_MESSAGES + 4))), 'the newest is kept');
  assert.ok(!out.some((l) => l.endsWith(': m0')), 'the oldest is dropped');
});

test('#7875: a long first line is cut to LINE_MAX', () => {
  const line = day.firstLine('x'.repeat(day.LINE_MAX + 50));
  assert.equal(line.length, day.LINE_MAX);
  assert.ok(line.endsWith('...'));
  assert.equal(day.firstLine('\n\n  hello  \nworld'), 'hello');
});

test('#7875: tasks this agent changed today, by number and kinds, never a title; others\' rows and other days left out', () => {
  const rows = {
    'catalog.task-3': [
      { at: at(10, 0), kind: 'assigned', by: 'Dana', title: 'SECRET TITLE' },
      { at: at(11, 0), kind: 'built', by: 'Dana' },
      { at: at(11, 5), kind: 'built', by: 'Dana' },
    ],
    'catalog.task-7': [{ at: at(12, 0), kind: 'built', by: 'Eli' }],
    'launch.task-1': [{ at: at(9, 0, 2), kind: 'created', by: 'Dana' }],
    'launch.task-2': [{ at: at(9, 0), kind: 'created', by: 'Dana' }],
  };
  const out = run({
    readThread: () => [],
    listTaskFiles: () => ['launch.task-2.jsonl', 'catalog.task-3.jsonl', 'catalog.task-7.jsonl', 'launch.task-1.jsonl', 'notes.txt'],
    readTask: (p, n) => rows[p + '.task-' + n] || [],
  });
  const text = out.join('\n');
  assert.ok(text.includes('  catalog #3: assigned, built'), text);
  assert.ok(text.includes('  launch #2: created'), text);
  assert.ok(!text.includes('catalog #7'), 'another agent\'s change is not listed');
  assert.ok(!text.includes('launch #1'), 'yesterday\'s change is not listed');
  assert.ok(!text.includes('SECRET TITLE'), 'no title');
  assert.ok(text.indexOf('catalog #3') < text.indexOf('launch #2'), 'by project');
});

test('#7875: no tasks today and unreadable tasks read differently', () => {
  assert.ok(run({ readThread: () => [] }).includes('Tasks you changed today: none.'));
  const bad = run({ readThread: () => [], listTaskFiles: () => { throw new Error('no'); } }).join('\n');
  assert.ok(bad.includes('Tasks you changed today: Kosmos could not read them on this computer.'), bad);
});

test('#7875: the default day is the report\'s own day (feedback.today)', () => {
  const out = day.digest({ name: 'Dana', readThread: () => [], listTaskFiles: () => [], readTask: () => [] });
  assert.ok(out[0].includes(fb.today()), out[0]);
});

test('#7875: the daily ask tells the agent to run kosmos feedback day first', () => {
  const text = require('./feedbacknudge').nudgeText();
  assert.match(text, /first run `kosmos feedback day`/);
});

test('#7875: both CLIs carry the day subcommand and list it in their usage', () => {
  const root = path.join(__dirname, '..');
  const sh = fs.readFileSync(path.join(root, 'install', 'kosmos'), 'utf8');
  const win = fs.readFileSync(path.join(root, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  assert.match(sh, /\n {4}day\)\n/);
  assert.match(sh, /engine\/feedbackday"\)\.digest\(\{ name \}\)/);
  assert.match(sh, /kosmos feedback day {16}\(your own day/);
  assert.match(win, /day: feedbackDay/);
  assert.match(win, /kosmos feedback day {16}\(your own day/);
});
