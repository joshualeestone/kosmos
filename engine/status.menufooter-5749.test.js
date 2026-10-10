'use strict';
/* #5749: Claude Code's question menu reads needs-you when its highlight is on the unnumbered Submit row (no `❯ N.` row in
 * the tail) and on the footer-less review tab. The screens are real captures (2.1.296) in test-support/claude-screens. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-menufooter-5749-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const read = (f) => fs.readFileSync(path.join(SCREENS, f), 'utf8');
const SUBMIT = read('question-menu-multiselect-submit-highlighted-2.1.296.txt');
const REVIEW = read('question-menu-review-tab-2.1.296.txt');
const PERM = read('permission-prompt-bash-2.1.296.txt');
// A native Claude pane (its command is the version), so classify takes the Claude path.
const PANE = { command: '2.1.296', title: '✳ x', session: 'x', name: 'x' };

test('#5749: the highlight on the multi-select Submit row reads needs-you (no numbered highlighted row on screen)', () => {
  assert.ok(!/^\s*❯\s*\d+\.\s/m.test(SUBMIT), 'CONTROL: the capture has no numbered highlighted row');
  assert.equal(status.classify(PANE, SUBMIT).state, 'needs_you');
});

test('#5749: the review tab, which draws no footer, is the question menu', () => {
  assert.ok(!/Esc to cancel/.test(REVIEW), 'CONTROL: the capture has no footer');
  assert.equal(status.claudeQuestionMenuUp(REVIEW), true);
  assert.equal(status.classify(PANE, REVIEW).state, 'needs_you');
});

test('#5749: controls: a permission prompt is not the menu, and an old review tab in scrollback is not live', () => {
  assert.equal(status.claudeQuestionMenuUp(PERM), false, 'a permission prompt read as the question menu');
  const idleAfter = REVIEW + '\n\n⏺ Submitted.\n\n────────\n❯ \n────────\n  ? for shortcuts';
  assert.equal(status.claudeQuestionMenuUp(idleAfter), false, 'an old review tab above the prompt read as live');
});
