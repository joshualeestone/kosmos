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
