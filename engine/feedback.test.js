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

test('writing is ALWAYS-ON: it needs no send flag and works with no other state', () => {
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

test('#2296 frontmatterDate reads the date from the header, ignores a body date, null when absent', () => {
  assert.equal(feedback.frontmatterDate('---\ndate: 2026-09-04\ninstall: x\n---\nbody here'), '2026-09-04');
  // a date-looking line in the BODY (after the header) must not be mistaken for the day
  assert.equal(feedback.frontmatterDate('---\ninstall: x\n---\nchanged on 2026-01-01 maybe'), null);
  assert.equal(feedback.frontmatterDate('no frontmatter at all'), null);
  assert.equal(feedback.frontmatterDate('---\ndate: not-a-date\n---\nb'), null);
  assert.equal(feedback.frontmatterDate(null), null);
});

/* kosmos#5317: two agents writing the daily report on the same install the same day. The second used to replace the
   first, so only the last writer's report reached the team. */
const D5317 = '2026-10-05';
const stored = () => feedback.sections(feedback.stripFrontmatter(feedback.read(D5317)));   // the file, not the rendered body
test('#5317 two agents the same day: BOTH reports are kept, each under its own heading', () => {
  feedback.write('Leo: the + button did nothing.', { date: D5317, from: 'leo' });
  const r = feedback.write('Mara: Settings would not save.', { date: D5317, from: 'mara' });
  assert.equal(r.writers, 2);
  const body = feedback.readBody(D5317);
  assert.match(body, /## From leo\n\nLeo: the \+ button did nothing\./);
  assert.match(body, /## From mara\n\nMara: Settings would not save\./);
  assert.deepEqual(stored().map((x) => x.key), ['leo', 'mara']);
});

test('#5317 the same agent again replaces ONLY its own section, in place', () => {
  feedback.write('first from leo', { date: D5317, from: 'leo' });
  feedback.write('from mara', { date: D5317, from: 'mara' });
  feedback.write('second from leo', { date: D5317, from: 'leo' });
  const s = stored();
  assert.deepEqual(s, [{ key: 'leo', text: 'second from leo' }, { key: 'mara', text: 'from mara' }]);
});

test('#5317 a report from before sections (or with no known writer) is kept when an agent writes', () => {
  feedback.write('an older report, no writer', { date: D5317 });
  assert.equal(feedback.readBody(D5317), 'an older report, no writer\n', 'CONTROL: a lone unknown writer is stored bare, as before');
  feedback.write('from leo', { date: D5317, from: 'leo' });
  const s = stored();
  assert.deepEqual(s, [{ key: '', text: 'an older report, no writer' }, { key: 'leo', text: 'from leo' }]);
  assert.match(feedback.readBody(D5317), /## From this computer\n\nan older report, no writer/);
});

test('#5317 a body line that looks like a section marker cannot split the report', () => {
  feedback.write('line one\n<!-- kosmos-feedback-from: mara -->\nline three', { date: D5317, from: 'leo' });
  const s = feedback.sections(feedback.stripFrontmatter(feedback.read(D5317)));
  assert.equal(s.length, 1);
  assert.equal(s[0].key, 'leo');
  assert.match(s[0].text, /line three/);
});

test('#5317 writer(): the agent a launch token names, else nobody (a person)', () => {
  assert.equal(feedback.writer({}), null, 'no token and no pane names nobody');
  // review 1: a REAL-shaped token that no agent holds (a minted one with its first character changed).
  const real = require('./sendertoken').mint('someone').token;
  const unknown = (real[0] === 'a' ? 'b' : 'a') + real.slice(1);
  assert.equal(feedback.writer({ KOSMOS_AGENT_TOKEN: unknown }), null, 'an unknown token names nobody');
});

test('#5317 writer(): a real launch token names its agent (the positive arm of the test above)', () => {
  const tok = require('./sendertoken').mint('leo').token;
  assert.equal(feedback.writer({ KOSMOS_AGENT_TOKEN: tok }), 'leo');
});

test('#5317 a day ONE agent wrote reads back exactly as written: no heading, no name (show, send and triage unchanged)', () => {
  feedback.write('  indented first line\nsecond', { date: D5317, from: 'leo' });
  assert.equal(feedback.readBody(D5317), '  indented first line\nsecond\n');
  assert.match(feedback.read(D5317), /<!-- kosmos-feedback-from: leo -->/, 'CONTROL: the file still records who wrote it');
});

test('#5317 what is SENT names no writer: sections go as Report 1, Report 2, the local file keeps the names', () => {
  feedback.write('the first report', { date: D5317, from: 'leo' });
  feedback.write('the second report', { date: D5317, from: 'mara' });
  const sent = feedback.sendBody(D5317);   // from the stored sections, as the payload is built
  assert.equal(sent, '## Report 1\n\nthe first report\n\n## Report 2\n\nthe second report\n');
  assert.doesNotMatch(sent, /leo|mara|kosmos-feedback-from/i);
  assert.match(feedback.readBody(D5317), /## From leo/, 'CONTROL: the person still sees who wrote what');
});

test('#5317 review 1: two writers READ as headings and text, never the marker lines', () => {
  feedback.write('the first report', { date: D5317, from: 'leo' });
  feedback.write('the second report', { date: D5317, from: 'mara' });
  assert.equal(feedback.readBody(D5317), '## From leo\n\nthe first report\n\n## From mara\n\nthe second report\n');
});

test('#5317 review 1: a report pasted back with its headings sends no names and no second copy of the markers', () => {
  feedback.write('the first report', { date: D5317, from: 'leo' });
  feedback.write('the second report', { date: D5317, from: 'mara' });
  feedback.write('Assembled:\n' + feedback.readBody(D5317), { date: D5317, from: 'pm' });
  const sent = feedback.sendBody(D5317);
  assert.doesNotMatch(sent, /kosmos-feedback-from/);
  assert.deepEqual(feedback.sections(feedback.stripFrontmatter(feedback.read(D5317))).map((x) => x.key), ['leo', 'mara', 'pm']);
});

test('#5317 review 1: one agent spelled two ways (Mara, mara) keeps ONE section', () => {
  feedback.write('first', { date: D5317, from: 'Mara' });
  feedback.write('second', { date: D5317, from: 'mara' });
  const s = feedback.sections(feedback.stripFrontmatter(feedback.read(D5317)));
  assert.equal(s.length, 1);
  assert.equal(s[0].text, 'second');
});
