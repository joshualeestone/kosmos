'use strict';
/**
 * The local daily product-feedback report (kosmos#2037): written to the user's
 * own disk unconditionally (the send switch gates transmission, not the write),
 * one markdown file per LOCAL day, with a small frontmatter header and a
 * path-safe date. Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-feedback-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const feedback = require('./feedback');

test.afterEach(() => {
  fs.rmSync(feedback.dir(), { recursive: true, force: true });
});

test('the report dir lands under the sandboxed data root, so the tests are isolated', () => {
  assert.ok(feedback.dir().startsWith(SANDBOX), `dir ${feedback.dir()} not under ${SANDBOX}`);
});

test('write then read round-trips the agent-authored body', () => {
  const body = '## Did not work\n- The + button did nothing.\n\n## Suggestions\n- Label it.';
  const res = feedback.write(body, { date: '2026-09-04' });
  assert.equal(res.ok, true);
  assert.equal(res.date, '2026-09-04');
  assert.ok(feedback.read('2026-09-04').includes('The + button did nothing.'));
  assert.equal(feedback.readBody('2026-09-04').trim(), body.trim());
});

test('writing is ALWAYS-ON: it needs no send/opt-in flag and works with no other state', () => {
  // No ping/notify setup, no switch: the local write must still happen. This
  // is Josh's "store locally regardless of the switch": the write is unconditional.
  const res = feedback.write('anything', { date: '2026-09-04' });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(res.path), 'report file was not written');
});

test('the file carries a frontmatter header: date, install, generated_at', () => {
  feedback.write('body', { date: '2026-09-04' });
  const raw = feedback.read('2026-09-04');
  assert.match(raw, /^---\n/);
  assert.match(raw, /\ndate: 2026-09-04\n/);
  assert.match(raw, /\ninstall: .+\n/);
  assert.match(raw, /\ngenerated_at: \d{4}-\d{2}-\d{2}T/);
});

test('readBody strips the frontmatter and returns only the body', () => {
  feedback.write('just the body', { date: '2026-09-04' });
  const body = feedback.readBody('2026-09-04');
  assert.equal(body.trim(), 'just the body');
  assert.ok(!body.includes('---'), 'frontmatter leaked into readBody');
});

test('write is idempotent per day: a second write replaces, not appends', () => {
  feedback.write('first', { date: '2026-09-04' });
  feedback.write('second', { date: '2026-09-04' });
  assert.equal(feedback.readBody('2026-09-04').trim(), 'second');
  assert.deepEqual(feedback.list(), ['2026-09-04']); // one file, not two
});

test('list returns dates newest-first; empty when nothing is written', () => {
  assert.deepEqual(feedback.list(), []);
  feedback.write('a', { date: '2026-09-02' });
  feedback.write('b', { date: '2026-09-04' });
  feedback.write('c', { date: '2026-09-03' });
  assert.deepEqual(feedback.list(), ['2026-09-04', '2026-09-03', '2026-09-02']);
});

test('has() reflects presence', () => {
  assert.equal(feedback.has('2026-09-04'), false);
  feedback.write('x', { date: '2026-09-04' });
  assert.equal(feedback.has('2026-09-04'), true);
});

test('read/readBody return null for a missing day rather than throwing', () => {
  assert.equal(feedback.read('2020-01-01'), null);
  assert.equal(feedback.readBody('2020-01-01'), null);
});

test('dateKey is LOCAL YYYY-MM-DD, and today() matches it', () => {
  const d = new Date(2026, 8, 4, 23, 30); // local Sep 4 2026 23:30 (month is 0-based)
  assert.equal(feedback.dateKey(d), '2026-09-04');
  assert.equal(feedback.today(), feedback.dateKey(new Date()));
});

test('isDateKey accepts a bare YYYY-MM-DD string and rejects everything else', () => {
  assert.equal(feedback.isDateKey('2026-09-04'), true);
  assert.equal(feedback.isDateKey('2026-9-4'), false);   // must be zero-padded
  assert.equal(feedback.isDateKey('../../oops'), false);
  assert.equal(feedback.isDateKey(''), false);
  // Non-strings are rejected, not ToString-coerced (a JSON number/array/object).
  assert.equal(feedback.isDateKey(20260904), false);
  assert.equal(feedback.isDateKey(['2026-09-04']), false);
  assert.equal(feedback.isDateKey({}), false);
  assert.equal(feedback.isDateKey(null), false);
});

test('the date is path-safe: a traversal date is refused, not written outside the dir', () => {
  assert.throws(() => feedback.pathFor('../../etc/passwd'), /YYYY-MM-DD/);
  assert.throws(() => feedback.write('evil', { date: '../../oops' }), /YYYY-MM-DD/);
  assert.throws(() => feedback.read('2026-9-4'), /YYYY-MM-DD/); // must be zero-padded
});

test('default write targets today (no date option needed)', () => {
  const res = feedback.write('todays report');
  assert.equal(res.date, feedback.today());
  assert.equal(feedback.readBody(feedback.today()).trim(), 'todays report');
});
