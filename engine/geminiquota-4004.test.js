'use strict';
/**
 * #4004: a Gemini API-key agent on Google's free daily limit. The two screens below are captured verbatim from Gemini
 * CLI 0.61.0 in a real tmux pane, driven by a fake endpoint answering Google's daily-quota 429 (2026-09-26).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gemq-4004-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const chat = require('./chat');
const geminiquota = require('./geminiquota');
const { accountProblemOf } = require('./accountproblem');
const fleet = require('../test-support/fleet');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const DIALOG = [
  ' > hello',
  '╭──────────────────────────────────────────────────╮',
  '│                                                  │',
  '│ Usage limit reached for gemini-2.5-flash.        │',
  '│ /stats model for usage details                   │',
  '│ /model to switch models.                         │',
  '│                                                  │',
  '│ ● 1. Keep trying                                 │',
  '│   2. Stop                                        │',
  '│                                                  │',
  '╰──────────────────────────────────────────────────╯',
].join('\n');
const AFTER_STOP = [
  ' > hello',
  '✕ [API Error: You have exhausted your daily quota on this model.]',
  '  Please wait and try again later. To increase your limits, request a quota increase through AI Studio, or switch to',
  '  another /auth method',
  '                                                   ? for shortcuts',
  ' YOLO Ctrl+Y',
  ' *   Type your message or @path/to/file',
  ' workspace (/directory)                         sandbox            /model',
].join('\n');
const [gem] = status.parsePanes('gemq\t0.0\tnode\t0\tgemq\tgemini\t');

test('#4004: the quota question reads rate_limited, waiting on Keep trying or Stop, with Gemini\'s own words', () => {
  const c = status.classify(gem, DIALOG);
  assert.equal(c.state, 'rate_limited', JSON.stringify(c));
  assert.equal(c.quotaDialog, true);
  assert.match(c.because, /waiting on Keep trying or Stop/);
  assert.equal(c.evidence, 'Usage limit reached for gemini-2.5-flash.');
});

test('#4004: after Stop, the quota error at its prompt still reads rate_limited (not idle)', () => {
  const c = status.classify(gem, AFTER_STOP);
  assert.equal(c.state, 'rate_limited', JSON.stringify(c));
  assert.equal(c.quotaDialog, false);
  assert.match(c.evidence, /exhausted your daily quota/);
});

test('#4004 CONTROLS: a newer turn after the error, and the same words on a non-Gemini pane, are not this reading', () => {
  const newer = AFTER_STOP + '\n > thanks, try again tomorrow\n✦ Sure, I will wait.';
  assert.notEqual(status.classify(gem, newer).state, 'rate_limited', 'a turn after the error still read as the limit');
  const [claude] = status.parsePanes('cl\t0.0\t2.1.283\t0\tcl\t\t');
  const c = status.classify(claude, DIALOG);
  assert.notEqual(c.quotaDialog, true, 'a Claude pane was read with Gemini\'s quota rule');
});

test('#4004: the card and the manager are told in plain words, with the reset and the two ways out', () => {
  const p = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: status.classify(gem, DIALOG).because });
  assert.ok(p && p.notify === true, JSON.stringify(p));
  assert.match(p.text, /Google's free daily limit for Gem's API key is used up/);
  assert.match(p.text, /midnight Pacific/);
  assert.match(p.text, /Google AI Studio/);
  assert.match(p.text, /Google Gemini \(Google subscription\)/);
  // CONTROL: another Gemini usage limit (not the daily one) keeps the general wording.
  const other = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: 'its screen says it has hit a usage limit' });
  assert.doesNotMatch(other.text, /free daily limit/);
});

test('#4004 sweep: answers only a Gemini card waiting on the question, and not twice within a minute', () => {
  const calls = [];
  const answer = (s) => { calls.push(s); return { ok: true, key: '2' }; };
  const roster = [
    { sessionName: 'gemq', runner: 'gemini', state: 'rate_limited', because: 'its screen says its Google daily limit is used up, and it is waiting on Keep trying or Stop' },
    { sessionName: 'gemdone', runner: 'gemini', state: 'rate_limited', because: 'its screen says its Google daily limit is used up' },
    { sessionName: 'cx', runner: 'codex', state: 'rate_limited', because: 'waiting on Keep trying or Stop' },
  ];
  const book = new Map();
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 });
  assert.deepEqual(calls, ['gemq']);
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 + 30 * 1000 });
  assert.deepEqual(calls, ['gemq'], 'answered again within the minute');
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 + 61 * 1000 });
  assert.deepEqual(calls, ['gemq', 'gemq'], 'a question still up after a minute was not answered again');
});

function fakeTmux() {
  const calls = [];
  const fn = (args) => { calls.push(args); return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; };
  fn.calls = calls;
  return fn;
}

test('#4004 answerGeminiQuotaStop: presses the number beside Stop when the question is up, and nothing when it is not', () => {
  const board = fleet.install([fleet.agent('gemq', { state: 'rate_limited', runner: 'gemini', command: 'node', screen: DIALOG })]);
  try {
    const tmux = fakeTmux();
    chat.setRunner(tmux);
    chat.setDryRun(false);
    status.setPaneCapture(() => DIALOG);
    const out = chat.answerGeminiQuotaStop('gemq', board.agents);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.key, '2');
    const sent = tmux.calls.filter((a) => a[0] === 'send-keys');
    assert.equal(sent.length, 1);
    assert.equal(sent[0][sent[0].length - 1], '2', 'it did not press the Stop number');
    // The screen changed (the question was answered, or never there): nothing is pressed.
    status.setPaneCapture(() => AFTER_STOP);
    const none = chat.answerGeminiQuotaStop('gemq', board.agents);
    assert.equal(none.ok, false);
    assert.equal(tmux.calls.filter((a) => a[0] === 'send-keys').length, 1, 'a key was pressed with no question on screen');
  } finally {
    status.setPaneCapture(null);
    chat.setRunner(null);
    chat.setDryRun(true);
    board.restore();
  }
});
