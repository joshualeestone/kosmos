'use strict';
/* kosmos#6265: `kosmos feedback triage` with no --dir read this computer's own daily reports, not the folder
   `kosmos feedback pull` had just filled, and said nothing about which it read. Now it reads the pulled folder when it
   holds reports, else its own, and every run names the folder it read (both commands print the notes on stderr). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-triagedir-6265-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const feedback = require('./feedback');
const feedbackpull = require('./feedbackpull');

const PULLED = feedbackpull.defaultDir();
const OWN = feedback.dir();
function reset() {
  for (const d of [PULLED, OWN]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(OWN, { recursive: true });
  fs.writeFileSync(path.join(OWN, '2026-10-01.md'), 'an old report from this computer\n');
}
function pulled(name, body) {
  fs.mkdirSync(PULLED, { recursive: true });
  fs.writeFileSync(path.join(PULLED, name), body);
}
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('#6265: both folders are inside the sandbox (PRECONDITION)', () => {
  assert.ok(PULLED.startsWith(SANDBOX) && OWN.startsWith(SANDBOX));
  assert.notEqual(PULLED, OWN);
});

test('#6265: after a pull, no --dir reads the pulled reports and says so', () => {
  reset();
  pulled('2026-10-14__abc.md', '---\ndate: 2026-10-14\ninstall: abc\n---\nthe newest report from a user\n');
  const got = feedback.reportsForTriage({});
  assert.equal(got.ok, true);
  assert.equal(got.read, PULLED);
  assert.deepEqual(got.reports.map((r) => r.date), ['2026-10-14']);
  assert.match(got.reports[0].body, /newest report from a user/);
  assert.ok(got.notes.some((n) => n.includes('pulled reports in ' + PULLED)), got.notes.join('\n'));
});

test('#6265 CONTROL: with nothing pulled, this computer\'s own reports are read, and the note says the pulled folder was empty', () => {
  reset();
  const got = feedback.reportsForTriage({});
  assert.equal(got.read, OWN);
  assert.deepEqual(got.reports.map((r) => r.date), ['2026-10-01']);
  assert.ok(got.notes.some((n) => n.includes('own reports in ' + OWN) && n.includes('no pulled reports in ' + PULLED)), got.notes.join('\n'));
  // A pulled folder that exists but holds no reports reads the same way.
  fs.mkdirSync(PULLED, { recursive: true });
  fs.writeFileSync(path.join(PULLED, 'notes.txt'), 'not a report');
  assert.equal(feedback.reportsForTriage({}).read, OWN);
});

test('#6265: --dir still reads exactly that folder, and the note names it', () => {
  reset();
  pulled('2026-10-14__abc.md', 'pulled\n');
  const other = path.join(SANDBOX, 'elsewhere');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, '2026-09-30.md'), 'from elsewhere\n');
  const got = feedback.reportsForTriage({ dir: other });
  assert.equal(got.read, other);
  assert.deepEqual(got.reports.map((r) => r.date), ['2026-09-30']);
  assert.ok(got.notes.includes('triage read the reports in ' + other));
  assert.equal(feedback.reportsForTriage({ dir: path.join(SANDBOX, 'missing') }).ok, false, 'an unreadable --dir still refuses');
});

test('#6265: --since applies to the pulled folder too', () => {
  reset();
  pulled('2026-10-10__a.md', '---\ndate: 2026-10-10\n---\nolder\n');
  pulled('2026-10-14__b.md', '---\ndate: 2026-10-14\n---\nnewer\n');
  const got = feedback.reportsForTriage({ since: '2026-10-12' });
  assert.equal(got.read, PULLED);
  assert.deepEqual(got.reports.map((r) => r.date), ['2026-10-14']);
  assert.deepEqual(feedback.reportsForTriage({}).reports.map((r) => r.date), ['2026-10-10', '2026-10-14'], 'CONTROL: both without --since');
});

test('#6265 review 1: a pulled folder whose only .md is not a file (a subdirectory) falls back to this computer\'s reports', () => {
  reset();
  fs.mkdirSync(path.join(PULLED, 'odd.md'), { recursive: true });
  assert.equal(feedback.reportsForTriage({}).read, OWN);
  // CONTROL: a real report file beside it makes the pulled folder the one read.
  pulled(feedbackpull.fileName({ date: '2026-10-14', install: 'abc' }), '---\ndate: 2026-10-14\n---\nreal\n');
  assert.equal(feedback.reportsForTriage({}).read, PULLED);
});

test('#6265 review 1: an undated pulled report (undated__<install>.md) is skipped by --since and read without it', () => {
  reset();
  pulled(feedbackpull.fileName({ install: 'x' }), 'no date anywhere\n');
  pulled(feedbackpull.fileName({ date: '2026-10-14', install: 'y' }), '---\ndate: 2026-10-14\n---\ndated\n');
  assert.deepEqual(feedback.reportsForTriage({ since: '2026-10-01' }).reports.map((r) => r.date), ['2026-10-14']);
  assert.equal(feedback.reportsForTriage({}).reports.length, 2);
});
