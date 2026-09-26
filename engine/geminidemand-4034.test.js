'use strict';
/**
 * #4034: Gemini's question box for conditions other than a usage limit. NOT_FOUND is captured verbatim (trailing
 * space trimmed) from Gemini CLI 0.61.0 in a real tmux pane, driven by a fake endpoint answering 404 NOT_FOUND
 * (2026-09-26). The high-demand box is not captured: its words are Gemini's source text, in the same component.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gemd-4034-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const geminiquota = require('./geminiquota');
const fleet = require('../test-support/fleet');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
test.beforeEach(() => geminiquota.resetForTest());

const NOT_FOUND = [
  " > hello there",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮",
  "│                                                                                                                      │",
  "│ Model \"gemini-2.5-flash\" was not found or is invalid.                                                                │",
  "│ /model to switch models.                                                                                             │",
  "│                                                                                                                      │",
  "│                                                                                                                      │",
  "│ ● 1. Keep trying                                                                                                     │",
  "│   2. Stop                                                                                                            │",
  "│                                                                                                                      │",
  "│                                                                                                                      │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
].join('\n');
/* The same box with the high-demand message from Gemini's source (capacity branch: three options). */
const HIGH_DEMAND = NOT_FOUND
  .replace('Model "gemini-2.5-flash" was not found or is invalid.', 'We are currently experiencing high demand for gemini-2.5-flash.')
  .replace('/model to switch models.', 'We apologize and appreciate your patience.')
  .replace('● 1. Keep trying', '● 1. Keep trying\n│   2. Switch to gemini-2.5-pro')
  .replace('  2. Stop', '  3. Stop');
const [gem] = status.parsePanes(fleet.line(fleet.agent('gemd', { ours: 'claim', runner: 'gemini', command: 'node', state: 'idle' })));
const [claude] = status.parsePanes(fleet.line(fleet.agent('cl', { ours: 'claim', runner: 'claude', command: 'claude', state: 'idle' })));

test('#4034: a model-not-found question reads needs_you with Gemini\'s own first line, and is not a usage limit', () => {
  const c = status.classify(gem, NOT_FOUND);
  assert.equal(c.state, 'needs_you', JSON.stringify(c));
  assert.equal(c.evidence, 'Model "gemini-2.5-flash" was not found or is invalid.');
  assert.match(c.because, /^Gemini is waiting on a question: Model "gemini-2\.5-flash" was not found/);
  assert.notEqual(c.quotaDialog, true, 'the Stop sweep would answer it');
});

test('#4034: a high-demand question (three options) reads needs_you too', () => {
  assert.ok(HIGH_DEMAND.includes('3. Stop') && HIGH_DEMAND.includes('high demand'), 'the fixture edit did not apply');
  const c = status.classify(gem, HIGH_DEMAND);
  assert.equal(c.state, 'needs_you', JSON.stringify(c));
  assert.equal(c.evidence, 'We are currently experiencing high demand for gemini-2.5-flash.');
});

test('#4034 CONTROLS: a usage limit stays #4004\'s, a quoted box with a working screen below is not a question, and a Claude pane is not read this way', () => {
  const limit = NOT_FOUND.replace('Model "gemini-2.5-flash" was not found or is invalid.', 'Usage limit reached for gemini-2.5-flash.');
  const l = status.classify(gem, limit);
  assert.equal(l.state, 'rate_limited', JSON.stringify(l));
  assert.equal(l.quotaDialog, true);
  const quoted = ['✦ Checking the other agent', NOT_FOUND, '⠏ Thinking (esc to cancel, 3s)', ' *   Type your message or @path/to/file'].join('\n');
  assert.notEqual(status.classify(gem, quoted).state, 'needs_you', 'a quoted box read as this agent\'s question');
  assert.equal(status.geminiQuestionReading(quoted), null);
  const c = status.classify(claude, NOT_FOUND);
  assert.notEqual(c.because || '', status.classify(gem, NOT_FOUND).because, 'a Claude pane was read with the Gemini rule');
  const noStop = NOT_FOUND.replace('  2. Stop', '  2. Later');
  assert.ok(noStop !== NOT_FOUND, 'the fixture edit did not apply');
  assert.equal(status.geminiQuestionReading(noStop), null, 'a box with no Stop option read as the question');
});

test('#4034 review round 1: Stop anywhere among the options, and a first line that starts with a slash is still the message', () => {
  const stopMiddle = NOT_FOUND.replace('  2. Stop', '  2. Stop\n│   3. Something else');
  assert.ok(stopMiddle.includes('3. Something else'), 'the fixture edit did not apply');
  assert.equal(status.geminiQuestionReading(stopMiddle).evidence, 'Model "gemini-2.5-flash" was not found or is invalid.');
  const slashFirst = NOT_FOUND.replace('Model "gemini-2.5-flash" was not found or is invalid.', '/models/custom-x was rejected.');
  assert.ok(slashFirst.includes('/models/custom-x'), 'the fixture edit did not apply');
  assert.equal(status.geminiQuestionReading(slashFirst).evidence, '/models/custom-x was rejected.');
});

test('#4034 review round 2: the agent page finds the question the card names, and a narrow pane\'s wrapping does not cut the reason', () => {
  const chat = require('./chat');
  const q = chat.questionIn(NOT_FOUND);
  assert.ok(q && q.text.includes('was not found or is invalid') && q.text.includes('2. Stop'), 'questionIn did not find the box: ' + JSON.stringify(q));
  assert.ok(q.text.startsWith('╭'), 'the question does not start at the box top: ' + JSON.stringify(q.text.slice(0, 40)));
  const quoted = ['✦ Checking the other agent', NOT_FOUND, '⠏ Thinking (esc to cancel, 3s)', ' *   Type your message or @path/to/file'].join('\n');
  assert.equal(chat.questionIn(quoted), null, 'a quoted box was offered as this agent\'s question');
  const narrow = [
    ' > hello there',
    '╭──────────────────────────────────────╮',
    '│                                      │',
    '│ Model "gemini-2.5-flash" was not     │',
    '│ found or is invalid.                 │',
    '│ /model to switch models.             │',
    '│                                      │',
    '│ ● 1. Keep trying                     │',
    '│   2. Stop                            │',
    '│                                      │',
    '╰──────────────────────────────────────╯',
  ].join('\n');
  assert.equal(status.geminiQuestionReading(narrow).evidence, 'Model "gemini-2.5-flash" was not found or is invalid.');
});
