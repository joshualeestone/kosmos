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

test('#6487 a report\'s words are found by its exact time; another time is nothing, and a report with no reason says what it waits for', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phonenotice-'));
  const file = path.join(dir, 'irma.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ state: 'working', at: '2026-10-22T18:00:00.000Z', because: 'earlier' }),
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:28:40.123Z', because: 'Can I send the lease to Hana?' }),
    'not json',
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:30:00.000Z' }),
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:31:00.000Z', on: 'the lease from Hana.' }),
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:32:00.000Z', owner: 'Angel', by: 'agent' }),
    JSON.stringify({ state: 'needs_you', at: '2026-10-22T18:33:00.000Z', on: 'which plan do you want?', by: 'agent' }),
  ].join('\n') + '\n');
  const selfreport = { fileFor: () => file };
  try {
    assert.equal(pn.reportNote('irma', '2026-10-22T18:28:40.123Z', { selfreport }), 'Can I send the lease to Hana?');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:28:41.000Z', { selfreport }), null, 'a time that is not there');
    // kosmos#6487: a report with no reason still answers true words, so the phone shows the agent and something said.
    assert.equal(pn.reportNote('irma', '2026-10-22T18:30:00.000Z', { selfreport }), 'Waiting for your answer.', 'a report with no reason');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:31:00.000Z', { selfreport }), 'Waiting on the lease from Hana.', 'a report waiting on something');
    // Review 1: an --owner-only report names who must act, never "waiting for your answer" when it is someone else.
    assert.equal(pn.reportNote('irma', '2026-10-22T18:32:00.000Z', { selfreport }), 'Waiting on Angel.', 'an --owner-only report');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:33:00.000Z', { selfreport }), 'Waiting on which plan do you want?', 'no full stop after a question (review 2)');
    assert.equal(pn.reportNote('irma', 'x', { selfreport: { fileFor: () => path.join(dir, 'none.jsonl') } }), null, 'no file');
    assert.equal(pn.reportNote('irma', '2026-10-22T18:00:00.000Z', { selfreport }), null, 'a working row at that time is not a needs_you report');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6487 a reply is the AGENT\'s own message at that time, never the person\'s', () => {
  const at = '2026-10-22T18:28:40.123Z';
  const chat = { DIRECT: '@you', readThread: () => ({ messages: [
    { at, text: 'the person said this at the same moment' },   // a real row of the person's carries no `from`
    { at, from: 'irma', text: 'Irma replied this' },
  ] }) };
  assert.equal(pn.replyText('irma', at, { chat }), 'Irma replied this');
  assert.equal(pn.replyText('leo', at, { chat }), null, 'another agent');
  assert.equal(pn.replyText('irma', at, { chat: { DIRECT: '@you', readThread: () => { throw new Error('unreadable'); } } }), null);
  assert.deepEqual(pn.wordsFor('reply:' + at + ':irma', { chat }), { kind: 'reply', session: 'irma', text: 'Irma replied this' });
  assert.equal(pn.wordsFor('reply:' + at + ':nobody', { chat }), null);
  const onlyPerson = { DIRECT: '@you', readThread: () => ({ messages: [{ at, text: 'only the person spoke' }] }) };
  assert.equal(pn.replyText('irma', at, { chat: onlyPerson }), null, 'the person\'s own message is never served as the agent\'s');
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
    // The read (window plus the one byte before it) starts exactly at the `{` of a line whose start (GARBAGE) is
    // outside: that half row parses on its own, and it must still not be read as a report.
    assert.equal(pn.reportNote('irma', at, { selfreport, tailBytes: size - 'GARBAGE'.length - 1 }), null);
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

test('#6487 explain says why there are no words, and idKind names only the id\'s kind', () => {
  const at = '2026-10-22T18:28:40.123Z';
  const selfreport = { fileFor: () => '/nonexistent/aw-6487-explain.jsonl' };
  const chat = { DIRECT: '@you', readThread: () => ({ messages: [{ at, from: 'leo', text: 'Sent it.' }] }) };
  const messages = { record: () => ({ rows: [] }) };
  assert.deepEqual(pn.explain('crashloop:leo:' + at, {}), { got: null, why: 'unaskable' });
  assert.deepEqual(pn.explain('nonsense', {}), { got: null, why: 'unaskable' });
  for (const bad of ['report:not-a-time:leo', 'reply:' + at + ':', 'post:x42']) assert.deepEqual(pn.explain(bad, {}), { got: null, why: 'malformed-id' }, bad);
  assert.deepEqual(pn.explain('report:' + at + ':leo', { selfreport }), { got: null, why: 'no-report-words' });
  assert.deepEqual(pn.explain('reply:2020-01-01T00:00:00.000Z:leo', { chat }), { got: null, why: 'no-reply' });
  assert.deepEqual(pn.explain('post:m42', { messages }), { got: null, why: 'no-post' });
  assert.deepEqual(pn.explain('reply:' + at + ':leo', { chat, mask: () => { throw new Error('x'); } }), { got: null, why: 'mask-failed' });
  assert.deepEqual(pn.explain('reply:' + at + ':leo', { chat, mask: () => 42 }), { got: null, why: 'mask-failed' });
  // CONTROL: the same reply with words answers them, why null, and wordsFor is exactly its `got`.
  assert.deepEqual(pn.explain('reply:' + at + ':leo', { chat }), { got: { kind: 'reply', session: 'leo', text: 'Sent it.' }, why: null });
  assert.deepEqual(pn.wordsFor('reply:' + at + ':leo', { chat }), { kind: 'reply', session: 'leo', text: 'Sent it.' });
  assert.equal(pn.idKind('stuckterminal:leo:' + at), 'stuckterminal');
  assert.equal(pn.idKind('report:' + at + ':leo'), 'report');
  for (const bad of ['', 'nonsense', 'Report:x', 'a b:c', null, 42, 'x'.repeat(21) + ':y']) assert.equal(pn.idKind(bad), 'unknown', String(bad));
});

test('#6487 logName blanks controls, separators, zero-width and direction marks, and keeps 80 characters', () => {
  assert.equal(pn.logName('a\n\u009bb c‮d​e⁦f﻿g'), 'a  b c d e f g');
  assert.equal(pn.logName('Roo Pixel'), 'Roo Pixel', 'CONTROL: a plain name is untouched');
  assert.equal(pn.logName('z'.repeat(100)).length, 80);
  assert.equal(pn.logName(null), '');
  assert.equal(pn.logName('a\u061cb\u2060c'), 'a b c');
  assert.equal(pn.logName('z'.repeat(79) + '\u{1F600}x'), 'z'.repeat(79) + '\u{1F600}', 'the 80th character is a whole emoji');
});
