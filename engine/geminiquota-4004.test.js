'use strict';
/**
 * #4004: a Gemini API-key agent on Google's daily limit. The two screens below are captured verbatim from Gemini
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
test.beforeEach(() => geminiquota.resetForTest());

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
/* A Gemini pane tied by its claim (fixture discipline: the line is built from PANE_COLUMNS, never hand-typed). */
const [gem] = status.parsePanes(fleet.line(fleet.agent('gemq', { ours: 'claim', runner: 'gemini', command: 'node', state: 'idle' })));

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
  // The spinner alone (no "esc to cancel" text) is enough to say it is working.
  const spinOnly = quotedErr.replace('⠏ Thinking (esc to cancel, 4s)', '⠏ Thinking');
  assert.notEqual(status.classify(gem, spinOnly).state, 'rate_limited', 'a spinner under a quoted error was not seen');
  // A grep that prints the phrase is not Gemini's error line.
  const grep = ['✦ Searching', 'engine/status.js:1590: const GEMINI_QUOTA_ERROR = /exhausted your daily quota/', ' *   Type your message or @path/to/file'].join('\n');
  assert.notEqual(status.classify(gem, grep).state, 'rate_limited', 'grep output read as the daily limit');
  // A turn since the error, drawn where Gemini draws it (above the composer): the person's message alone, and the
  // agent's answer alone, each end the reading.
  const composerAt = '                                                   ? for shortcuts';
  const personSince = AFTER_STOP.replace(composerAt, ' > thanks, try again tomorrow\n' + composerAt);
  assert.notEqual(status.classify(gem, personSince).state, 'rate_limited', 'a message sent after the error still read as the limit');
  const agentSince = AFTER_STOP.replace(composerAt, '✦ Sure, I will wait.\n' + composerAt);
  assert.notEqual(status.classify(gem, agentSince).state, 'rate_limited', 'an answer after the error still read as the limit');
  // The error with no composer under it (a screen caught mid-redraw) is not the agent sitting at its prompt.
  const noComposer = AFTER_STOP.split('\n').slice(0, 4).join('\n');
  assert.notEqual(status.classify(gem, noComposer).state, 'rate_limited', 'the error with no prompt under it read as the limit');
  // An error scrolled out of the last rows is old: fourteen rows of output since, then the prompt.
  const filler = Array.from({ length: 14 }, (_, i) => `  line ${i + 1} of the agent's own output`).join('\n');
  const scrolled = AFTER_STOP.replace(composerAt, filler + '\n' + composerAt);
  assert.notEqual(status.classify(gem, scrolled).state, 'rate_limited', 'an error scrolled out of the last rows still read as the limit');
  const [claude] = status.parsePanes(fleet.line(fleet.agent('cl', { ours: 'claim', command: '2.1.283', state: 'idle' })));
  const c = status.classify(claude, DIALOG);
  assert.notEqual(c.quotaDialog, true, 'a Claude pane was read with Gemini\'s quota rule');
});

test('#4004: after Stop on ANOTHER limit, Google\'s own quota line still reads the limit, said without a reset time', () => {
  // Gemini prints Google's message (not "exhausted your daily quota") when the question came up for, say, a model the
  // key has no free quota for. Before this, the card read a calm idle the moment Kosmos pressed Stop.
  const other = AFTER_STOP.replace('✕ [API Error: You have exhausted your daily quota on this model.]',
    '✕ [API Error: You exceeded your current quota, please check your plan and billing details. limit: 0, model: gemini-2.5-pro]');
  assert.notEqual(other, AFTER_STOP, 'the fixture edit did not apply');
  const c = status.classify(gem, other);
  assert.equal(c.state, 'rate_limited', JSON.stringify(c));
  assert.equal(c.quotaDaily, false);
  const p = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: c.because, limitFrom: c.limitFrom, quotaDialog: c.quotaDialog, quotaDaily: c.quotaDaily });
  assert.match(p.text, /reached a Google usage limit/);
  assert.doesNotMatch(p.text, /midnight|daily limit/, 'a reset time promised for a limit that is not the daily one');
  // CONTROL: the same line inside a working agent's tool output is not this agent's limit.
  const quoted = ['✦ Checking', '│ ✕ [API Error: You exceeded your current quota, limit: 0]', '⠏ Thinking (esc to cancel, 2s)', ' *   Type your message or @path/to/file'].join('\n');
  assert.notEqual(status.classify(gem, quoted).state, 'rate_limited');
});

test('#4004 CONTROLS: a quota line QUOTED by a working agent whose turn has ended is not its own limit', () => {
  // Review round 9: its turn is over (nothing working below, its composer back), so only the quote marks remain.
  for (const line of ['✕ [API Error: You have exhausted your daily quota on this model.]', '✕ [API Error: You exceeded your current quota, limit: 0]']) {
    const inTool = ['✦ I checked the other agent\'s pane and it shows:', '│ ' + line, '│ That agent is stuck.',
      '                                                   ? for shortcuts', ' *   Type your message or @path/to/file'].join('\n');
    assert.notEqual(status.classify(gem, inTool).state, 'rate_limited', 'a line quoted in tool output read as this agent\'s limit: ' + line);
    const inAnswer = ['✦ The other agent is stuck on this:', '  ' + line, '  It resets at midnight.',
      '                                                   ? for shortcuts', ' *   Type your message or @path/to/file'].join('\n');
    assert.notEqual(status.classify(gem, inAnswer).state, 'rate_limited', 'a line quoted in its answer read as this agent\'s limit: ' + line);
  }
  // CONTROL: the same line at the left edge, Gemini's own, is the limit.
  assert.equal(status.classify(gem, AFTER_STOP).state, 'rate_limited');
});

test('#4004: after Kosmos answered Stop, Google\'s own words (any) at the left edge read as the limit, for a while only', () => {
  // Review round 11: reasons like INSUFFICIENT_G1_CREDITS_BALANCE raise the same question, then print Google's text.
  const googleText = AFTER_STOP.replace('✕ [API Error: You have exhausted your daily quota on this model.]',
    '✕ [API Error: Your project has insufficient credits for this request.]');
  assert.notEqual(googleText, AFTER_STOP, 'the fixture edit did not apply');
  assert.notEqual(status.classify(gem, googleText).state, 'rate_limited', 'CONTROL: without Kosmos\'s answer an unknown error line is not a limit');
  const now = Date.now();
  geminiquota.noteAnswered('gemq', now);
  const c = status.classify(gem, googleText);
  assert.equal(c.state, 'rate_limited', JSON.stringify(c));
  assert.equal(c.quotaDaily, false, 'a reset time would be promised for a limit nobody named');
  // The same words quoted in a working agent's tool output still do not count, answer or not.
  const quoted = ['✦ Checking', '│ ✕ [API Error: Your project has insufficient credits for this request.]', '│', ' *   Type your message or @path/to/file'].join('\n');
  assert.notEqual(status.classify(gem, quoted).state, 'rate_limited');
  // Long after the answer, the line is just an error again.
  geminiquota.noteAnswered('gemq', now - geminiquota.AFTER_STOP_MS - 1000);
  assert.notEqual(status.classify(gem, googleText).state, 'rate_limited', 'the answer was remembered forever');
});

test('#4004: the sweep remembers only answers that were given', () => {
  const roster = boardCards([['gemq', DIALOG]]).filter((c) => c.sessionName === 'gemq');
  assert.equal(roster.length, 1);
  const now = Date.now();
  geminiquota.sweepOnce({ roster, answer: () => ({ ok: false, because: 'no' }), book: new Map(), now });
  assert.equal(geminiquota.answeredRecently('gemq', now), false, 'a failed answer was remembered as given');
  geminiquota.sweepOnce({ roster, answer: () => ({ ok: true, key: '2' }), book: new Map(), now });
  assert.equal(geminiquota.answeredRecently('gemq', now), true);
});

test('#4004: the API-key layouts of the question ([Switch, Stop] and [Keep trying, Switch, Stop]) are read, Stop key and all', () => {
  const opt = (t) => '│ ' + t.padEnd(49) + '│';
  const layouts = [
    [opt('● 1. Switch to gemini-2.5-flash-lite'), opt('  2. Stop')],
    [opt('● 1. Keep trying'), opt('  2. Switch to gemini-2.5-flash-lite'), opt('  3. Stop')],
  ];
  const at = DIALOG.split('\n');
  const start = at.findIndex((l) => /1\. Keep trying/.test(l));
  for (const rows of layouts) {
    const screen = [...at.slice(0, start), ...rows, ...at.slice(start + 2)].join('\n');
    const c = status.classify(gem, screen);
    assert.equal(c.quotaDialog, true, screen);
    assert.equal(status.geminiStopKey(screen), String(rows.length));
  }
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
  // CONTROL: the same box with no Stop among its options is not the question Kosmos can answer.
  const noStop = DIALOG.replace('│   2. Stop                                        │', '│   2. Wait                                        │');
  assert.notEqual(noStop, DIALOG, 'the fixture edit did not apply');
  assert.notEqual(status.classify(gem, noStop).quotaDialog, true, 'a quota box with no Stop option read as the question');
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

test('#4004: an AUTOMATIC report (Gemini\'s bridge ending the failed turn) does not outrank the limit on screen', () => {
  const scraped = status.classify(gem, AFTER_STOP);
  for (const state of ['idle', 'working']) {
    const out = status.reconcileReport({ found: true, state, by: 'auto', auto: true, at: new Date().toISOString() }, scraped, Date.now());
    assert.equal(out.state, 'rate_limited', `a fresh automatic ${state} report outranked the limit: ` + JSON.stringify(out));
  }
  // CONTROL: the same fresh report filed by the agent itself keeps the ordinary rule (it may be working through it).
  const own = status.reconcileReport({ found: true, state: 'working', by: 'agent', because: 'retrying', at: new Date().toISOString() }, scraped, Date.now());
  assert.notEqual(own.state, 'rate_limited');
});

test('#4004 snapshot: the board card carries quotaDialog and limitFrom, so the sweep answers it and the manager is told', () => {
  const board = fleet.install([fleet.agent('gemsnap', { state: 'rate_limited', runner: 'gemini', command: 'node', screen: DIALOG })]);
  try {
    let card = status.snapshot().agents.find((a) => a.sessionName === 'gemsnap');
    assert.equal(card.state, 'rate_limited', JSON.stringify(card && { state: card.state, because: card.because }));
    assert.equal(card.quotaDialog, true);
    assert.equal(card.limitFrom, 'gemini');
    assert.equal(geminiquota.waitingOnQuestion(card), true, 'the sweep would not answer the board\'s own card');
    assert.ok(accountProblemOf(card).notify === true, 'the manager would not be told');
    board.restore();
    const after = fleet.install([fleet.agent('gemsnap', { state: 'rate_limited', runner: 'gemini', command: 'node', screen: AFTER_STOP })]);
    try {
      card = status.snapshot().agents.find((a) => a.sessionName === 'gemsnap');
      assert.equal(card.quotaDialog, false);
      assert.equal(card.limitFrom, 'gemini');
      assert.equal(geminiquota.waitingOnQuestion(card), false, 'CONTROL: no question up, nothing to answer');
      assert.equal(card.quotaDaily, true);
      // The sweep records its answer under the CARD's session name; the reading looks it up by the pane's name. They
      // must be the same name, or the after-Stop reading never fires on the board.
      assert.equal(card.sessionName, 'gemsnap');
      assert.match(accountProblemOf(card).text, /daily limit for/);
    } finally { after.restore(); }
    const googleText = AFTER_STOP.replace('✕ [API Error: You have exhausted your daily quota on this model.]', '✕ [API Error: Your project has insufficient credits.]');
    const other = fleet.install([fleet.agent('gemsnap', { state: 'idle', runner: 'gemini', command: 'node', screen: googleText })]);
    try {
      geminiquota.noteAnswered(status.snapshot().agents.find((a) => a.sessionName === 'gemsnap').sessionName);
      const card2 = status.snapshot().agents.find((a) => a.sessionName === 'gemsnap');
      assert.equal(card2.state, 'rate_limited', 'the sweep\'s answer, recorded under the card\'s name, did not reach the reading');
    } finally { other.restore(); }
  } finally { board.restore(); }
});

test('#4004: the card and the manager are told in plain words, with the reset and the two ways out', () => {
  // After Stop: Gemini's own "exhausted your daily quota" line is a daily limit, free or billed (it cannot say which).
  const c = status.classify(gem, AFTER_STOP);
  const p = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: c.because, limitFrom: c.limitFrom, quotaDialog: c.quotaDialog, quotaDaily: c.quotaDaily });
  assert.ok(p && p.notify === true, JSON.stringify(p));
  assert.match(p.text, /Google's daily limit for Gem's API key is used up/);
  assert.doesNotMatch(p.text, /free/, 'the screen cannot tell a free key from a billed one');
  assert.match(p.text, /To raise it, add billing/);
  assert.match(p.text, /midnight Pacific/);
  assert.match(p.text, /Google AI Studio/);
  assert.match(p.text, /Google Gemini \(Google subscription\)/);
  // While only the question is up, the limit may not be a daily one: said neutrally, no midnight promise.
  const d = status.classify(gem, DIALOG);
  const q = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: d.because, limitFrom: d.limitFrom, quotaDialog: d.quotaDialog });
  assert.match(q.text, /reached a Google usage limit/);
  assert.doesNotMatch(q.text, /Kosmos is answering/, 'it claims an answer the sweep may be switched off from giving');
  assert.doesNotMatch(q.text, /midnight|daily limit/);
  // CONTROL: another Gemini usage limit (not the daily one) keeps the general wording.
  const other = accountProblemOf({ name: 'Gem', runner: 'gemini', state: 'rate_limited', because: 'its screen mentions a usage limit', limitFrom: null });
  assert.doesNotMatch(other.text, /daily limit for/);
});

/* The board's own cards (fixture discipline: never hand-built), for a fleet of Gemini panes. */
function boardCards(specs) {
  const board = fleet.install(specs.map(([name, screen]) => fleet.agent(name, { state: 'rate_limited', runner: 'gemini', command: 'node', screen })));
  try { return status.snapshot().agents; } finally { board.restore(); }
}

test('#4004 sweep: answers only a Gemini card waiting on the question, and not twice within a minute', () => {
  const calls = [];
  const answer = (s) => { calls.push(s); return { ok: true, key: '2' }; };
  const cards = boardCards([['gemq', DIALOG], ['gemdone', AFTER_STOP], ['cx', DIALOG]]);
  const byName = (n) => cards.find((c) => c.sessionName === n);
  assert.equal(byName('gemq').quotaDialog, true, 'CONTROL: the board reads the question on gemq');
  // The same card on another runner: the sweep answers Gemini's question only for a Gemini agent.
  const roster = [byName('gemq'), byName('gemdone'), { ...byName('cx'), runner: 'codex' }];
  const book = new Map();
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 });
  assert.deepEqual(calls, ['gemq']);
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 + 30 * 1000 });
  assert.deepEqual(calls, ['gemq'], 'answered again within the minute');
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 + 61 * 1000 });
  assert.deepEqual(calls, ['gemq', 'gemq'], 'a question still up after a minute was not answered again');
  // Once the question is gone, its record goes too, so a question that comes back later is answered at once.
  geminiquota.sweepOnce({ roster: [roster[1], roster[2]], answer, book, now: 1e6 + 62 * 1000 });
  assert.equal(book.has('gemq'), false, 'a record outlived the question it was for');
  geminiquota.sweepOnce({ roster, answer, book, now: 1e6 + 63 * 1000 });
  assert.deepEqual(calls, ['gemq', 'gemq', 'gemq'], 'a question that came back was held behind an old record');
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
    // The 3-option question (Switch / Upgrade / Stop): the key pressed is the one beside Stop, 3, never a fixed 2
    // (which would choose Upgrade). Review round 10.
    const three = DIALOG.replace('│ ● 1. Keep trying                                 │\n│   2. Stop                                        │',
      '│ ● 1. Switch to gemini-2.5-flash-lite              │\n│   2. Upgrade for higher limits                   │\n│   3. Stop                                        │');
    assert.notEqual(three, DIALOG, 'the fixture edit did not apply');
    status.setPaneCapture(() => three);
    const t3 = chat.answerGeminiQuotaStop('gemq', board.agents);
    assert.equal(t3.ok, true, JSON.stringify(t3));
    const sent3 = tmux.calls.filter((a) => a[0] === 'send-keys');
    assert.equal(sent3.length, 2);
    assert.equal(sent3[1][sent3[1].length - 1], '3', 'the key beside Stop was not the one pressed');
    // A WORKING agent whose tool output quotes another pane's question (Stop row and all) is not asking it: the
    // re-read must refuse on the reading itself, not only because no Stop number is on screen.
    const quoted = ['✦ Checking the stuck agent', '│ $ tmux capture-pane -p -t other', DIALOG, '⠏ Thinking (esc to cancel, 3s)', ' *   Type your message or @path/to/file'].join('\n');
    assert.equal(status.geminiStopKey(quoted), '2', 'CONTROL: the quoted copy does carry a Stop number');
    status.setPaneCapture(() => quoted);
    const q = chat.answerGeminiQuotaStop('gemq', board.agents);
    assert.equal(q.ok, false, 'a key was pressed into a pane only quoting the question');
    assert.equal(tmux.calls.filter((a) => a[0] === 'send-keys').length, 2, 'a key was pressed into a pane only quoting the question');
    // The limit line with a stray "2. Stop" row on screen (in the agent's own text, say) is not the question either.
    const stray = AFTER_STOP.replace('                                                   ? for shortcuts', '  2. Stop\n                                                   ? for shortcuts');
    assert.notEqual(stray, AFTER_STOP, 'the fixture edit did not apply');
    assert.equal(status.geminiStopKey(stray), '2', 'CONTROL: the stray row does carry a Stop number');
    status.setPaneCapture(() => stray);
    assert.equal(chat.answerGeminiQuotaStop('gemq', board.agents).ok, false, 'a key was pressed with only the limit line up');
    assert.equal(tmux.calls.filter((a) => a[0] === 'send-keys').length, 2, 'a key was pressed with only the limit line up');
    // The screen changed (the question was answered, or never there): nothing is pressed.
    status.setPaneCapture(() => AFTER_STOP);
    const none = chat.answerGeminiQuotaStop('gemq', board.agents);
    assert.equal(none.ok, false);
    assert.equal(tmux.calls.filter((a) => a[0] === 'send-keys').length, 2, 'a key was pressed with no question on screen');
  } finally {
    status.setPaneCapture(null);
    chat.setRunner(null);
    chat.setDryRun(true);
    board.restore();
  }
});
