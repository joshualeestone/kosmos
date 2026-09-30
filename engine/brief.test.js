'use strict';
/* #3595 phase 3: reading a project's goal from BRIEF.md. The parser against the REAL seeded stub
 * (projects.briefStubContent), and the safe reader against real files, a symlink and an oversize
 * file.
 *
 *   node --test engine/brief.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const brief = require('./brief');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('the seeded stub with its placeholder has NO goal; the same stub with a description does', () => {
  assert.equal(brief.goalFrom(projects.briefStubContent({ name: 'Lease' })), null, 'the placeholder read as a goal');
  assert.equal(brief.goalFrom(projects.briefStubContent({ name: 'Lease', description: 'Renew the Henderson lease by March.' })),
    'Renew the Henderson lease by March.');
});

test('the Goal section ends at the next heading; blank, missing and comment-only sections are no goal', () => {
  const text = '# P\n\n## Goal\n\nShip the beta\nto ten testers.\n\n## Done looks like\n\nTen testers.\n';
  assert.equal(brief.goalFrom(text), 'Ship the beta to ten testers.');
  assert.equal(brief.goalFrom('# P\n\n## Goal\n\n\n## Done looks like\n\nx\n'), null);
  assert.equal(brief.goalFrom('# P\n\n## Done looks like\n\nx\n'), null, 'a brief with no Goal heading produced one');
  assert.equal(brief.goalFrom('# P\n\n## Goal\n\n<!-- write it here -->\n'), null);
  assert.equal(brief.goalFrom('## Goals:\n\nOne clear aim\n'), 'One clear aim', 'the plural/colon heading was missed');
  assert.equal(brief.goalFrom('## Goal\n\nShip\u001b[31m it\u0007 now\n'), 'Ship [31m it now', 'a control character survived into the goal');
  assert.equal(brief.goalFrom('## Goal\n\nShip\u0085 now\n'), 'Ship now', 'a C1 control character survived into the goal');
  assert.equal(brief.goalFrom(''), null);
  assert.equal(brief.goalFrom(null), null);
});

test('a long goal is trimmed for the pane line, by code point (an emoji is never split)', () => {
  const g = brief.goalFrom('## Goal\n\n' + 'x'.repeat(brief.GOAL_MAX * 2) + '\n');
  assert.equal(Array.from(g).length, brief.GOAL_MAX);
  const e = brief.goalFrom('## Goal\n\n' + '\u{1F680}'.repeat(brief.GOAL_MAX * 2) + '\n');
  assert.equal(Array.from(e).length, brief.GOAL_MAX);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(e), 'the trim left a lone surrogate');
});

test('readGoal: a real file is read; missing, a symlink, a directory and an oversize file are no goal', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'p-'));
  assert.equal(brief.readGoal(dir), null, 'a missing brief produced a goal');
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), '# P\n\n## Goal\n\nReal goal here.\n');
  assert.equal(brief.readGoal(dir), 'Real goal here.', 'control: a real brief was not read');

  const other = fs.mkdtempSync(path.join(SANDBOX, 'q-'));
  const target = path.join(SANDBOX, 'elsewhere.md');
  fs.writeFileSync(target, '## Goal\n\nFrom outside the folder.\n');
  fs.symlinkSync(target, path.join(other, 'BRIEF.md'));
  assert.equal(brief.readGoal(other), null, 'a symlinked brief was followed');

  const asDir = fs.mkdtempSync(path.join(SANDBOX, 'r-'));
  fs.mkdirSync(path.join(asDir, 'BRIEF.md'));
  assert.equal(brief.readGoal(asDir), null);

  const big = fs.mkdtempSync(path.join(SANDBOX, 's-'));
  fs.writeFileSync(path.join(big, 'BRIEF.md'), '## Goal\n\nBig.\n' + 'y'.repeat(brief.MAX_BYTES));
  assert.equal(brief.readGoal(big), null, 'an oversize brief was read');
  assert.equal(brief.readGoal(''), null);
  assert.equal(brief.readGoal(path.relative(process.cwd(), dir)), null, 'a relative folder was read against the working directory');
});

test('#4583 a done left blank (the "Not set yet" placeholder) is no done; one written is read as written', () => {
  assert.equal(brief.doneFrom(projects.briefStubContent({ name: 'Lease' })), null, 'the Not set yet placeholder read as a done');
  assert.equal(brief.doneFrom(projects.briefStubContent({ name: 'Lease', done: 'The lease is signed.' })), 'The lease is signed.');
  // CONTROL: the bold words with a person's own words after them are an answer, not the seeded prompt.
  assert.equal(brief.doneFrom('## Done looks like\n\n**Not set yet.** We will decide on Friday.\n'), '**Not set yet.** We will decide on Friday.');
  // The bold words left on their own are not.
  assert.equal(brief.doneFrom('## Done looks like\n\n**Not set yet.**\n'), null);
});

test('#4583 review: one rule for done set, so the badge, the room note and kosmos project show agree', () => {
  const S = (done) => '# P\n\n## Goal\n\nG.\n\n## Done looks like\n\n' + done + '\n';
  const cases = [
    // [what the Done section holds, what show prints, whether done is set]
    [projects.BRIEF_DONE_PLACEHOLDER, null, false],
    [projects.BRIEF_DONE_PLACEHOLDER + '\n\nThe lease is signed.', 'The lease is signed.', true],   // the placeholder left above an answer
    ['The lease is signed.\n\n' + projects.BRIEF_DONE_PLACEHOLDER, 'The lease is signed.', true],   // and below one
    ['**Not set yet.**\t_How will everyone know this is finished? Replace this line._', null, false],   // hand-mangled whitespace
    ['_Say what finished means. Replace this line._', null, false],   // a reworded prompt
    ['', null, false],   // an empty Done section
  ];
  for (const [section, shown, set] of cases) {
    assert.equal(brief.doneFrom(S(section)), shown, JSON.stringify(section));
    assert.equal(brief.doneSetFrom(S(section)), set, JSON.stringify(section));
  }
  // A person's own brief with no Done section says nothing is missing (as before); no brief text says nothing at all.
  assert.equal(brief.doneSetFrom('# Mine\n\n## Goal\n\nG.\n'), true);
  assert.equal(brief.doneSetFrom(null), null);
});

test('#4583 review round 2: a retitled Done heading still holding the placeholder is unset; CRLF reads the same', () => {
  const retitled = '# P\n\n## What done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n';
  assert.equal(brief.doneSetFrom(retitled), false, 'a placeholder under a retitled heading read as set');
  // CONTROL: the same retitled heading with the person's own words is set.
  assert.equal(brief.doneSetFrom('# P\n\n## What done looks like\n\nThe lease is signed.\n'), true);
  const crlf = '# P\r\n\r\n## Done looks like\r\n\r\n' + projects.BRIEF_DONE_PLACEHOLDER + '\r\n\r\nThe lease is signed.\r\n';
  assert.equal(brief.doneFrom(crlf), 'The lease is signed.');
  assert.equal(brief.doneSetFrom(crlf), true);
  assert.equal(brief.doneSetFrom('# P\r\n\r\n## Done looks like\r\n\r\n' + projects.BRIEF_DONE_PLACEHOLDER + '\r\n'), false);
});

