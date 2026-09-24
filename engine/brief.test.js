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
});
