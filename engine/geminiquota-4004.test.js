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

test('#4004: the quota question reads rate_limited, waiting on a question, with Gemini\'s own words', () => {
  const c = status.classify(gem, DIALOG);
  assert.equal(c.state, 'rate_limited', JSON.stringify(c));
  assert.equal(c.quotaDialog, true);
  assert.match(c.because, /waiting on a question/);
  assert.equal(c.evidence, 'Usage limit reached for gemini-2.5-flash.');
});

test('#4004: after Stop, the quota error at its prompt still reads rate_limited (not idle)', () => {
  const c = status.classify(gem, AFTER_STOP);
  assert.equal(c.state, 'rate_limited', JSON.stringify(c));
  assert.equal(c.quotaDialog, false);
  assert.match(c.evidence, /exhausted your daily quota/);
});

test('#4004 CONTROLS: the words in tool output, a quoted dialog, a newer turn, and a non-Gemini pane are not this reading', () => {
  // A working agent whose Shell output is another pane's capture of the dialog, with its own screen below it.
  const quoted = ['✦ Checking the stuck agent', '│ $ tmux capture-pane -p -t other', DIALOG, '⠏ Thinking (esc to cancel, 3s)', ' *   Type your message or @path/to/file'].join('\n');
  const q = status.classify(gem, quoted);
  assert.ok(!(q.state === 'rate_limited' && q.quotaDialog === true), 'a quoted dialog read as this agent\'s question: ' + JSON.stringify(q));
  // Another pane's quota ERROR in a working agent's tool output, spinner and composer below it.
  const quotedErr = ['✦ Checking the other agent', '│ ✕ [API Error: You have exhausted your daily quota on this model.]', '│', '⠏ Thinking (esc to cancel, 4s)', ' *   Type your message or @path/to/file'].join('\n');
  assert.notEqual(status.classify(gem, quotedErr).state, 'rate_limited', 'a quoted quota error read as this agent\'s limit');
  // A grep that prints the phrase is not Gemini's error line.
  const grep = ['✦ Searching', 'engine/status.js:1590: const GEMINI_QUOTA_ERROR = /exhausted your daily quota/', ' *   Type your message or @path/to/file'].join('\n');
  assert.notEqual(status.classify(gem, grep).state, 'rate_limited', 'grep output read as the daily limit');
  const newer = AFTER_STOP + '\n > thanks, try again tomorrow\n✦ Sure, I will wait.';
  assert.notEqual(status.classify(gem, newer).state, 'rate_limited', 'a turn after the error still read as the limit');
  const [claude] = status.parsePanes('cl\t0.0\t2.1.283\t0\tcl\t\t');
  const c = status.classify(claude, DIALOG);
  assert.notEqual(c.quotaDialog, true, 'a Claude pane was read with Gemini\'s quota rule');
});

test('#4004: after Stop with the non-YOLO composer (">   Type your message") below the error, it still reads the limit', () => {
  const nonYolo = AFTER_STOP.replace(' *   Type your message or @path/to/file', ' >   Type your message or @path/to/file');
  assert.equal(status.classify(gem, nonYolo).state, 'rate_limited');
});

test('#4004: the 3-option variant (Switch to <model> / Upgrade / Stop) is the question too, and Stop is read off it', () => {
  const three = DIALOG.replace('│ ● 1. Keep trying                                 │\n│   2. Stop                                        │',
    '│ ● 1. Switch to gemini-2.5-flash-lite              │\n│   2. Upgrade for higher limits                   │\n│   3. Stop                                        │');
  const c = status.classify(gem, three);
  assert.equal(c.quotaDialog, true, JSON.stringify(c));
  assert.equal(status.geminiStopKey(three), '3', 'the key for Stop was not read off the 3-option question');
  assert.equal(status.geminiStopKey(DIALOG), '2');
});

test('#4004: the question on screen stands over a fresh report the agent filed itself (it cannot be working through it)', () => {
  const scraped = status.classify(gem, DIALOG);
  const out = status.reconcileReport({ found: true, state: 'working', by: 'agent', because: 'writing tests', at: new Date().toISOString() }, scraped, Date.now());
  assert.equal(out.state, 'rate_limited', JSON.stringify(out));
  assert.equal(out.quotaDialog, true);
  // CONTROL: the same fresh report over the after-Stop screen (no question up) keeps the ordinary rule.
  const after = status.reconcileReport({ found: true, state: 'working', by: 'agent', because: 'writing tests', at: new Date().toISOString() }, status.classify(gem, AFTER_STOP), Date.now());
  assert.notEqual(after.state, 'rate_limited');
});

test('#4004: the card and the manager are told in plain words, with the reset and the two ways out', () => {
  // After Stop: Gemini's own "exhausted your daily quota" line is the free daily limit.
  const c = status.classify(gem, AFTER_STOP);
  const p = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: c.because, limitFrom: c.limitFrom, quotaDialog: c.quotaDialog });
  assert.ok(p && p.notify === true, JSON.stringify(p));
  assert.match(p.text, /Google's free daily limit for Gem's API key is used up/);
  assert.match(p.text, /midnight Pacific/);
  assert.match(p.text, /Google AI Studio/);
  assert.match(p.text, /Google Gemini \(Google subscription\)/);
  // While only the question is up, the limit may not be the free daily one: said neutrally, no midnight promise.
  const d = status.classify(gem, DIALOG);
  const q = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: d.because, limitFrom: d.limitFrom, quotaDialog: d.quotaDialog });
  assert.match(q.text, /reached a Google usage limit/);
  assert.doesNotMatch(q.text, /midnight|free daily/);
  // CONTROL: another Gemini usage limit (not the daily one) keeps the general wording.
  const other = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: 'its screen mentions a usage limit', limitFrom: null });
  assert.doesNotMatch(other.text, /free daily limit/);
});

test('#4004 sweep: answers only a Gemini card waiting on the question, and not twice within a minute', () => {
  const calls = [];
  const answer = (s) => { calls.push(s); return { ok: true, key: '2' }; };
  const dialog = status.classify(gem, DIALOG);
  const after = status.classify(gem, AFTER_STOP);
  const roster = [
    { sessionName: 'gemq', runner: 'gemini', state: dialog.state, because: dialog.because, quotaDialog: dialog.quotaDialog },
    { sessionName: 'gemdone', runner: 'gemini', state: after.state, because: after.because, quotaDialog: after.quotaDialog },
    { sessionName: 'cx', runner: 'codex', state: 'rate_limited', because: dialog.because, quotaDialog: true },
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
