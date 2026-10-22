'use strict';
// kosmos#6487: the words behind a phone notification, found where they already are (engine/phonenotice.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pn = require('./phonenotice');

test('#6487 an event id is split at the FIRST and LAST colon, since its time holds colons', () => {
  assert.deepEqual(pn.parseId('report:2026-10-22T18:28:40.123Z:irma'), { kind: 'report', at: '2026-10-22T18:28:40.123Z', session: 'irma' });
  assert.deepEqual(pn.parseId('reply:2026-10-22T18:28:40.123Z:leo-2'), { kind: 'reply', at: '2026-10-22T18:28:40.123Z', session: 'leo-2' });
  for (const bad of [null, '', 'report', 'report:irma', 'built:2026-10-22T18:28:40Z:irma', 'reply:not-a-time:irma', 'reply:2026-10-22T18:28:40Z:', 'x'.repeat(301)]) {
    assert.equal(pn.parseId(bad), null, JSON.stringify(bad));
  }
});

test('#6487 words are shortened for a lock screen at a word, and short ones are kept whole', () => {
  assert.equal(pn.shorten('  The fix is in.\n\n\n\nRun it.  '), 'The fix is in.\n\nRun it.');
  const long = 'word '.repeat(200);
  const s = pn.shorten(long);
  assert.ok(s.length <= pn.TEXT_MAX && s.endsWith('…') && !/\s…$/.test(s), JSON.stringify(s.slice(-20)));
  // No space to cut at, and an emoji's two halves straddle the cut: the lone half is dropped, never sent.
  const emoji = 'x'.repeat(pn.TEXT_MAX - 2) + '😀' + 'y'.repeat(20);
  const e = pn.shorten(emoji);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(e), 'a lone high surrogate before the ellipsis');
  assert.equal(e, 'x'.repeat(pn.TEXT_MAX - 2) + '…');
});

test('#6487 a report\'s reason (because) is found by its exact time; another time, or no reason, is nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phonenotice-'));
  const file = path.join(dir, 'irma.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ state: 'working', at: '2026-10-22T18:00:00.000Z', because: 'earlier' }),
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:28:40.123Z', because: 'Can I send the lease to Hana?' }),
    'not json',
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:30:00.000Z' }),
  ].join('\n') + '\n');
  const selfreport = { fileFor: () => file };
  try {
    assert.equal(pn.reportNote('irma', '2026-10-22T18:28:40.123Z', { selfreport }), 'Can I send the lease to Hana?');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:28:41.000Z', { selfreport }), null, 'a time that is not there');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:30:00.000Z', { selfreport }), null, 'a report with no reason');
    assert.equal(pn.reportNote('irma', 'x', { selfreport: { fileFor: () => path.join(dir, 'none.jsonl') } }), null, 'no file');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:00:00.000Z', { selfreport }), null, 'a working row at that time is not a needs_you report');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6487 a reply is the AGENT\'s own message at that time, never the person\'s', () => {
  const at = '2026-10-22T18:28:40.123Z';
  const chat = { DIRECT: '@you', readThread: () => ({ messages: [
    { at, from: 'you', text: 'the person said this at the same moment' },
    { at, from: 'irma', text: 'Irma replied this' },
  ] }) };
  assert.equal(pn.replyText('irma', at, { chat }), 'Irma replied this');
  assert.equal(pn.replyText('leo', at, { chat }), null, 'another agent');
  assert.equal(pn.replyText('irma', at, { chat: { DIRECT: '@you', readThread: () => { throw new Error('unreadable'); } } }), null);
  assert.deepEqual(pn.wordsFor('reply:' + at + ':irma', { chat }), { kind: 'reply', session: 'irma', text: 'Irma replied this' });
  assert.equal(pn.wordsFor('reply:' + at + ':nobody', { chat }), null);
});

test('#6487 only the END of a report file is read: a row before the window is nothing, and a cut first line is never parsed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phonenotice-tail-'));
  const file = path.join(dir, 'irma.jsonl');
  const old = JSON.stringify({ state: 'needs_you', at: '2026-10-22T17:00:00.000Z', because: 'an old question' });
  const filler = JSON.stringify({ state: 'working', at: '2026-10-22T17:30:00.000Z', because: 'x'.repeat(200) });
  const recent = JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:28:40.123Z', because: 'the new question' });
  fs.writeFileSync(file, [old, filler, filler, recent].join('\n') + '\n');
  const selfreport = { fileFor: () => file };
  const tailBytes = recent.length + filler.length + 40;   // ends inside the first filler row, past the old one
  try {
    assert.equal(pn.reportNote('irma', '2026-10-22T18:28:40.123Z', { selfreport, tailBytes }), 'the new question');
    assert.equal(pn.reportNote('irma', '2026-10-22T17:00:00.000Z', { selfreport, tailBytes }), null, 'before the window');
    // CONTROL: the same old row IS found when the window covers it, so the null above is the window, not the row.
    assert.equal(pn.reportNote('irma', '2026-10-22T17:00:00.000Z', { selfreport }), 'an old question');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6487 a window that starts partway into a row drops that row, and one that starts on a whole row keeps it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phonenotice-cut-'));
  const file = path.join(dir, 'irma.jsonl');
  const at = '2026-10-22T18:00:00.000Z';
  const whole = JSON.stringify({ state: 'needs_you', at, because: 'cut' });
  // The row is preceded on its OWN line by junk, so a window starting at its `{` sees text that parses on its own.
  fs.writeFileSync(file, 'GARBAGE' + whole + '\n' + whole.replace('cut', 'kept').replace(at, '2026-10-22T18:01:00.000Z') + '\n');
  const selfreport = { fileFor: () => file };
  const size = fs.statSync(file).size;
  try {
    // Starts at the `{` of a line whose start (GARBAGE) is outside: that half row must not be read as a report.
    assert.equal(pn.reportNote('irma', at, { selfreport, tailBytes: size - 'GARBAGE'.length }), null);
    // Starts exactly on the second line: that whole row is kept, not thrown away as if it were cut.
    const second = size - (whole.length + 1 + 'GARBAGE'.length);
    assert.equal(pn.reportNote('irma', '2026-10-22T18:01:00.000Z', { selfreport, tailBytes: second }), 'kept');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6487 the mask runs on the WHOLE words before they are shortened, and a mask that fails serves nothing', () => {
  const at = '2026-10-22T18:28:40.123Z';
  const secret = 'SECRET-' + 'k'.repeat(pn.TEXT_MAX);
  const text = 'ok '.repeat(30) + secret;   // one word longer than the limit, so the cut lands INSIDE it, not at a space
  const chat = { DIRECT: '@you', readThread: () => ({ messages: [{ at, from: 'guide', text }] }) };
  const seen = [];
  const mask = (who, t) => { seen.push([who, t.length]); return t.replace(/SECRET-k+/, '[hidden]'); };
  const got = pn.wordsFor('reply:' + at + ':guide', { chat, mask });
  assert.deepEqual(seen, [['guide', text.length]], 'the mask saw the whole words, for that agent');
  assert.ok(!got.text.includes('SECRET'), JSON.stringify(got.text.slice(-30)));
  assert.equal(pn.wordsFor('reply:' + at + ':guide', { chat, mask: () => { throw new Error('mask broke'); } }), null);
  // CONTROL: with no mask the cut words do carry part of the secret, so the test above can fail.
  assert.ok(pn.wordsFor('reply:' + at + ':guide', { chat }).text.includes('SECRET'));
});
