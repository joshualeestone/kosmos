'use strict';

/**
 * #5187: a message to a busy Antigravity agent queues in its CLI buffer while
 * the sender sees Placed.
 *
 * This test suite pins:
 * 1. antigravityQueued helper extracts queued message counts from pane text.
 * 2. classify returns STATE.WORKING with waiting count for Antigravity with queued messages.
 * 3. classify returns STATE.IDLE when sitting at prompt (? for shortcuts).
 * 4. reconcileReport preserves scraped.waiting when working report is fresh or decayed.
 * 5. chat.deliver returns queued: true when placing into a working Antigravity agent.
 * 6. messages.send records queued: true in messages.jsonl and returns queued: true and paneNote.
 * 7. Folded duplicate sends preserve queued: true.
 */

require('../test-support/tmpscope');

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-msgqueue-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const status = require('./status');
const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

test.after(() => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* clean */ }
});

test('#5187 antigravityQueued parses pane text for queued messages', () => {
  assert.equal(status.antigravityQueued(null), null);
  assert.equal(status.antigravityQueued(''), null);
  assert.equal(status.antigravityQueued('plain screen\n>'), null);

  const singleQueued = [
    '● Bash(find . -name "*.js")',
    '▸ [message from your colleague liukang · m4163] Johnny: check #5187',
    'Press up to edit queued messages',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  assert.deepEqual(status.antigravityQueued(singleQueued), { n: 1, yours: 0 });

  const multiQueued = [
    '▸ [message from your colleague liukang · m4089] Johnny Cage: first',
    '▸ [message from your colleague liukang · m4097] Johnny Cage: second',
    '▸ [message from your colleague liukang · m4103] Johnny Cage: third',
    'Press up to edit queued messages',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  assert.deepEqual(status.antigravityQueued(multiQueued), { n: 3, yours: 0 });

  const promptOnly = [
    'user-queued messages',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  assert.deepEqual(status.antigravityQueued(promptOnly), { n: 1, yours: 0 });

  // Kano review blocker 1: turn-start delivered message or agent-typed text
  // without queue prompt must strictly return null.
  const turnStartDelivered = [
    '● Bash(echo starting task)',
    '▸ [message from your colleague liukang · m4097] Johnny Cage: work on card',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  assert.equal(status.antigravityQueued(turnStartDelivered), null);

  const agentTypedText = [
    '● Bash(git log)',
    '    commit abc123',
    '    [message from your colleague liukang · m4000] old log',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  assert.equal(status.antigravityQueued(agentTypedText), null);
});

test('#5187 classify detects working, idle, and queued messages for Antigravity panes', () => {
  const agyPane = {
    name: 'dana',
    session: 'dana',
    claim: 'dana',
    command: 'agy',
    runner: 'antigravity',
  };

  const deadPane = {
    name: 'dana',
    session: 'dana',
    claim: 'dana',
    command: 'bash',
    runner: 'antigravity',
  };
  const deadRes = status.classify(deadPane, 'any');
  assert.equal(deadRes.state, status.STATE.STOPPED);

  const unreadableRes = status.classify(agyPane, null);
  assert.equal(unreadableRes.state, status.STATE.UNKNOWN);

  const idleScreen = [
    '● Bash(kosmos whoami)',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    '? for shortcuts                                          Gemini 3.8 Flash · high',
  ].join('\n');
  const idleRes = status.classify(agyPane, idleScreen);
  assert.equal(idleRes.state, status.STATE.IDLE);
  assert.equal(idleRes.waiting, undefined);

  const workingScreen = [
    '⣾  Running command...',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  const workingRes = status.classify(agyPane, workingScreen);
  assert.equal(workingRes.state, status.STATE.WORKING);
  assert.equal(workingRes.waiting, undefined);

  const queuedScreen = [
    '⣾  Running command...',
    '▸ [message from your colleague liukang · m4163] Johnny: review card',
    'Press up to edit queued messages',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  const queuedRes = status.classify(agyPane, queuedScreen);
  assert.equal(queuedRes.state, status.STATE.WORKING);
  assert.deepEqual(queuedRes.waiting, { n: 1, yours: 0 });

  // Kano review blocker 2: when messages are queued, footer replaces "esc to cancel"
  // with "Press up to edit queued messages", which must still classify as WORKING.
  const liveQueuedReplacedFooter = [
    '⣾  Running command...',
    '▸ [message from your colleague liukang · m4163] Johnny: review card',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'Press up to edit queued messages                         Gemini 3.8 Flash · high',
  ].join('\n');
  const liveQueuedRes = status.classify(agyPane, liveQueuedReplacedFooter);
  assert.equal(liveQueuedRes.state, status.STATE.WORKING);
  assert.deepEqual(liveQueuedRes.waiting, { n: 1, yours: 0 });

  // Turn-start without queue prompt must not attach waiting
  const turnStartScreen = [
    '⣾  Running command...',
    '▸ [message from your colleague liukang · m4097] Johnny: work on card',
    '────────────────────────────────────────────────────────────────────────────────',
    '>',
    '────────────────────────────────────────────────────────────────────────────────',
    'esc to cancel                                            Gemini 3.8 Flash · high',
  ].join('\n');
  const turnStartRes = status.classify(agyPane, turnStartScreen);
  assert.equal(turnStartRes.state, status.STATE.WORKING);
  assert.equal(turnStartRes.waiting, undefined);
});

test('#5187 reconcileReport preserves scraped.waiting when agent reports working', () => {
  const now = Date.now();
  const freshReport = {
    found: true,
    state: 'working',
    at: new Date(now - 1000).toISOString(),
    waiting: null,
  };
  const scrapedWorking = {
    state: status.STATE.WORKING,
    confidence: status.CONFIDENCE.SCRAPED,
    because: 'it is mid-task',
    waiting: { n: 2, yours: 0 },
  };

  const reconciled = status.reconcileReport(freshReport, scrapedWorking, now);
  assert.equal(reconciled.state, status.STATE.WORKING);
  assert.deepEqual(reconciled.waiting, { n: 2, yours: 0 });

  const staleReport = {
    found: true,
    state: 'working',
    at: new Date(now - 600000).toISOString(),
    waiting: null,
  };
  const decayed = status.reconcileReport(staleReport, scrapedWorking, now);
  assert.equal(decayed.state, status.STATE.WORKING);
  assert.deepEqual(decayed.waiting, { n: 2, yours: 0 });
});

test('#5187 chat.deliver returns queued: true when placing into busy Antigravity agent', () => {
  const board = fleet.install([
    fleet.agent('dana', { runner: 'antigravity', command: 'agy', screen: 'Working...\nesc to cancel', state: 'working' }),
  ]);

  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, status: 0, out: 'agy\tdana\t0', err: '' };
    return { ran: true, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  try {
    const res = chat.deliver('dana', 'hello', board.agents);
    assert.equal(res.state, chat.DELIVERY.PLACED);
    assert.equal(res.queued, true);
    assert.match(res.paneNote, /mid-task, so it will not read this until it finishes/);

    const idleBoard = fleet.install([
      fleet.agent('dana', { runner: 'antigravity', command: 'agy', screen: '> \n? for shortcuts', state: 'idle' }),
    ]);
    try {
      const idleRes = chat.deliver('dana', 'hello', idleBoard.agents);
      assert.equal(idleRes.state, chat.DELIVERY.PLACED);
      assert.equal(idleRes.queued, false);
    } finally {
      idleBoard.restore();
    }

    const claudeBoard = fleet.install([
      fleet.agent('dana', { runner: 'claude', state: 'working' }),
    ]);
    try {
      const claudeRes = chat.deliver('dana', 'hello', claudeBoard.agents);
      assert.equal(claudeRes.state, chat.DELIVERY.PLACED);
      assert.equal(claudeRes.queued, false);
    } finally {
      claudeBoard.restore();
    }
  } finally {
    chat.setRunner(null);
    chat.setDryRun(true);
    board.restore();
  }
});

test('#5187 messages.send records queued: true and returns queued receipt', () => {
  const board = fleet.install([
    fleet.agent('dana', { runner: 'antigravity', command: 'agy', screen: 'Working...\nesc to cancel', state: 'working' }),
    fleet.agent('casey', { runner: 'claude', state: 'idle' }),
  ]);
  const senderCard = board.card('casey');

  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, status: 0, out: 'agy\tdana\t0', err: '' };
    return { ran: true, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  messages.setRunner((pane) => ({ ok: true, session: 'casey' }));

  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ }

  try {
    const res = messages.send({
      fromPane: '%1',
      sender: { ok: true, name: 'casey', card: senderCard },
      to: 'dana',
      text: 'please pick up card 5187',
    }, board.agents);

    assert.equal(res.state, 'placed');
    assert.equal(res.queued, true);
    assert.match(res.paneNote, /mid-task/);

    const logLines = fs.readFileSync(messages.LOG, 'utf8').trim().split('\n');
    assert.equal(logLines.length, 1);
    const row = JSON.parse(logLines[0]);
    assert.equal(row.state, 'placed');
    assert.equal(row.queued, true);
    assert.equal(row.to, 'dana');

    const dupRes = messages.send({
      fromPane: '%1',
      sender: { ok: true, name: 'casey', card: senderCard },
      to: 'dana',
      text: 'please pick up card 5187',
    }, board.agents);

    assert.equal(dupRes.duplicate, true);
    assert.equal(dupRes.queued, true);
  } finally {
    chat.setRunner(null);
    chat.setDryRun(true);
    messages.setRunner(null);
    board.restore();
    try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ }
  }
});

