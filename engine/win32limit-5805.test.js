'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits
/**
 * #5805 (Windows): an agent whose account is out of usage reads rate_limited on its card, with the reset, and the
 * usage-limit hold keeps messages from being typed into a session that cannot answer.
 *
 * Before this, a Windows card's state came only from the event stream's turn boundaries (busy / idle), so a capped
 * account left every card idle and every message was counted as delivered (17 hours on the Windows box, 10-18/19).
 * These drive the REAL publisher writing a REAL state file, read through the REAL capture and status.snapshot(), and
 * ask the REAL hold. The rate_limit_event's shape is the installed Claude Code's own schema (rate_limit_info: status
 * allowed | allowed_warning | rejected, resetsAt epoch seconds, rateLimitType).
 *
 *   node --test engine/win32limit-5805.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32limit-5805-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const status = require('./status');
const chat = require('./chat');
const selfreport = require('./selfreport');
const win32capture = require('./win32capture');
const win32roster = require('./win32roster');
const win32streamstate = require('./win32streamstate');

const streaming = (sessionId, pid, name) => ({ pid, cwd: 'C:\\w', kind: 'interactive', startedAt: 1, sessionId, name });
const recordOf = (map) => ({ read: () => map });
const LIMIT_SENTENCE = "You've hit your weekly limit. Your limit resets Oct 21, 3pm (America/Chicago).";
const rejected = (resetsAtSec, kind) => ({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: resetsAtSec, rateLimitType: kind, isUsingOverage: false }, uuid: 'u', session_id: 's' });
const allowed = () => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: false }, uuid: 'u', session_id: 's' });
const failedTurn = () => ({ type: 'result', subtype: 'success', is_error: true, result: LIMIT_SENTENCE });

/** One agent on a fake Windows box, read through the real roster, capture and snapshot. */
function box(name, sid, pid) {
  const agents = [streaming(sid, pid, 'cwd-' + name)];
  const rec = recordOf({ [sid]: { name, runner: 'claude' } });
  const pub = win32streamstate.publisher(name);
  status.setPaneSource(win32roster.make({ run: () => agents, record: rec }));
  status.setPaneCapture(win32capture.make({ run: () => agents, record: rec, ttlMs: 0 }));
  const roster = () => status.snapshot().agents;
  const card = () => roster().find((a) => a.sessionName === name);
  return { pub, roster, card, done() { pub.stopped(); status.setPaneSource(null); status.setPaneCapture(null); } };
}

test('#5805 Windows: a rejected rate_limit_event reads rate_limited with its reset, carries the refused turn\'s sentence, and holds messages', () => {
  const b = box('winlimit', 'sid-l1', 7001);
  try {
    b.pub.started(7001, 'sid-l1');
    assert.equal(b.card().state, status.STATE.IDLE, 'CONTROL: started, idle');
    const reset = Math.floor(Date.now() / 1000) + 3600;
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event(rejected(reset, 'seven_day'));
    b.pub.event(failedTurn());
    const c = b.card();
    assert.equal(c.state, status.STATE.RATE_LIMITED, 'out of usage, not idle');
    assert.equal(c.limitUntil, new Date(reset * 1000).toISOString(), 'the reset the event gave, as the card\'s until');
    assert.equal(c.stateEvidence, LIMIT_SENTENCE, 'the refused turn\'s own sentence rides along');
    const held = chat.limitHeldVerdict('winlimit', b.roster());
    assert.ok(held && held.heldBy === 'limit', 'a message is held, not typed into a session that cannot answer: ' + JSON.stringify(held));
    const acct = chat.accountHeldVerdict('winlimit', b.roster());
    assert.ok(acct && acct.heldBy === 'limit', 'the delivery path\'s own check holds it too: ' + JSON.stringify(acct));
    /* Review 1: the sentence names its own date (Oct 21, 3pm); the hold uses the stream's reset, which the card shows. */
    assert.equal(held.limitReset, new Date(reset * 1000).toISOString(), 'the hold and the card agree on the reset');
  } finally { b.done(); }
});

test('#5805 Windows: room again (an allowed event, or a turn that succeeds) clears the limit, and nothing is held', () => {
  const b = box('winroom', 'sid-l2', 7002);
  try {
    b.pub.started(7002, 'sid-l2');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'CONTROL: limited first');
    b.pub.event(allowed());
    assert.equal(b.card().state, status.STATE.IDLE, 'an allowed event clears it');
    assert.equal(chat.limitHeldVerdict('winroom', b.roster()), null, 'nothing held once there is room');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'CONTROL: limited again after the first clear');
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'assistant', message: { content: [] } });
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
    assert.equal(b.card().state, status.STATE.IDLE, 'a turn that reached the model and ended without an error clears it too');
  } finally { b.done(); }
});

test('#5805 Windows CONTROL: allowed and warning events alone never read as a limit', () => {
  const b = box('winok', 'sid-l3', 7003);
  try {
    b.pub.started(7003, 'sid-l3');
    b.pub.event(allowed());
    b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.92 } });
    b.pub.event({ type: 'rate_limit_event' });
    assert.equal(b.card().state, status.STATE.IDLE);
    assert.equal(chat.limitHeldVerdict('winok', b.roster()), null);
  } finally { b.done(); }
});

test('#5805 Windows: a reset already past reads released (idle), so held messages go', () => {
  const b = box('winpast', 'sid-l4', 7004);
  try {
    b.pub.started(7004, 'sid-l4');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) - 60, 'seven_day'));
    assert.equal(b.card().state, status.STATE.IDLE, 'the reset has passed');
    assert.equal(chat.limitHeldVerdict('winpast', b.roster()), null);
  } finally { b.done(); }
});

test('#5805 Windows review 2-5: a refusal with no reset time is no claim, so it neither sets a limit nor clears a live one', () => {
  const b = box('winnodate', 'sid-l5', 7005);
  try {
    b.pub.started(7005, 'sid-l5');
    b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day' } });
    assert.equal(b.card().state, status.STATE.IDLE, 'alone: no limit');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day' } });
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'after a real refusal: the live limit is kept, not replaced by one with no reset');
  } finally { b.done(); }
});

test('#5805 Windows: resetsAt in milliseconds is read as the same moment, not 50000 years ahead', () => {
  const b = box('winms', 'sid-l6', 7006);
  try {
    b.pub.started(7006, 'sid-l6');
    const resetMs = (Math.floor(Date.now() / 1000) + 1800) * 1000;
    b.pub.event(rejected(resetMs, 'five_hour'));
    assert.equal(b.card().limitUntil, new Date(resetMs).toISOString());
  } finally { b.done(); }
});

for (const [label, extra] of [['isUsingOverage', { isUsingOverage: true }], ['overageInUse', { overageInUse: true }], ['overageStatus allowed', { overageStatus: 'allowed' }], ['overageStatus allowed_warning', { overageStatus: 'allowed_warning' }]]) {
  test('#5805 Windows review 1-2: a refusal its extra usage covers (' + label + ') is room, not out of usage', () => {
    const b = box('winover', 'sid-l7', 7007);
    try {
      b.pub.started(7007, 'sid-l7');
      b.pub.wrote();
      b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3 * 86400, rateLimitType: 'seven_day', ...extra } });
      assert.notEqual(b.card().state, status.STATE.RATE_LIMITED, 'still working on extra usage');
      assert.equal(chat.limitHeldVerdict('winover', b.roster()), null, 'nothing held');
    } finally { b.done(); }
  });
}

test('#5805 Windows review 1: a turn that never reached the model (a local command) does not clear the limit', () => {
  const b = box('winlocal', 'sid-l8', 7008);
  try {
    b.pub.started(7008, 'sid-l8');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: '' });
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'a local result made no API request, so it must not clear the limit');
  } finally { b.done(); }
});

test('#5805 Windows review 1: a later, different error does not replace the limit\'s sentence', () => {
  const b = box('winline', 'sid-l9', 7009);
  try {
    b.pub.started(7009, 'sid-l9');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'seven_day'));
    b.pub.event(failedTurn());
    b.pub.event({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 500 Internal server error' });
    assert.equal(b.card().stateEvidence, LIMIT_SENTENCE);
  } finally { b.done(); }
});

test('#5805 Windows review 2: a local command after a real turn does not clear a later limit (the flag resets per turn)', () => {
  const b = box('winflag', 'sid-l10', 7010);
  try {
    b.pub.started(7010, 'sid-l10');
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'assistant', message: { content: [] } });
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: '' });
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'the earlier real turn must not let a later local result clear it');
  } finally { b.done(); }
});

test('#5805 Windows review 2: a warning event after a refusal clears it (the account has room again)', () => {
  const b = box('winwarn', 'sid-l11', 7011);
  try {
    b.pub.started(7011, 'sid-l11');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'CONTROL: limited first');
    b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.95 } });
    assert.equal(b.card().state, status.STATE.IDLE);
  } finally { b.done(); }
});

test('#5805 Windows review 3: a REAL refused turn (its error as an assistant message, then is_error true) stays limited', () => {
  const b = box('winreal', 'sid-l12', 7012);
  try {
    b.pub.started(7012, 'sid-l12');
    const reset = Math.floor(Date.now() / 1000) + 3600;
    for (let i = 0; i < 2; i++) {
      b.pub.wrote();
      b.pub.event({ type: 'system', subtype: 'init' });
      b.pub.event(rejected(reset, 'five_hour'));
      if (i === 1) assert.equal(b.card().stateEvidence, LIMIT_SENTENCE, 'the repeated refusal keeps the sentence already read, before its own result arrives');
      b.pub.event({ type: 'assistant', message: { content: [{ type: 'text', text: LIMIT_SENTENCE }] } });
      b.pub.event(failedTurn());
      assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'turn ' + (i + 1) + ': the refused turn\'s own result must not clear the limit it set');
      assert.equal(b.card().stateEvidence, LIMIT_SENTENCE, 'turn ' + (i + 1) + ': Claude\'s own sentence, kept across the repeated refusal');
    }
  } finally { b.done(); }
});

test('#5805 Windows review 4: with no sentence from Claude yet, the card quotes nothing (never a line Kosmos wrote)', () => {
  const b = box('winquote', 'sid-l13', 7013);
  try {
    b.pub.started(7013, 'sid-l13');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    const c = b.card();
    assert.equal(c.state, status.STATE.RATE_LIMITED, 'CONTROL: limited');
    assert.ok(c.stateEvidence == null, 'no evidence rather than an invented quotation: ' + JSON.stringify(c.stateEvidence));
    assert.ok(chat.limitHeldVerdict('winquote', b.roster()), 'still held on the stream\'s reset');
  } finally { b.done(); }
});

test('#5805 Windows review 4: a write alone (no init) starts a new turn, so a later local result does not clear the limit', () => {
  const b = box('wininit', 'sid-l14', 7014);
  try {
    b.pub.started(7014, 'sid-l14');
    b.pub.wrote();
    b.pub.event({ type: 'assistant', message: { content: [] } });
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    b.pub.wrote();
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: '' });
    assert.equal(b.card().state, status.STATE.RATE_LIMITED);
  } finally { b.done(); }
});

for (const [label, report] of [
  ['an automatic working report (a message typed in)', { state: 'working', auto: true }],
  ['an automatic idle report (the refused turn ending, Stop)', { state: 'idle', auto: true }],
  ['StopFailure\'s automatic blocked provider api (rate_limit)', { state: 'blocked', auto: true, on: 'provider api (rate_limit)', owner: 'provider' }],
]) {
  test('#5805 Windows review 5: the stream\'s limit stands against ' + label + ', and messages are still held', () => {
    const name = 'winhook' + label.length;
    const b = box(name, 'sid-h' + label.length, 7100 + label.length);
    try {
      b.pub.started(7100 + label.length, 'sid-h' + label.length);
      b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
      assert.equal(selfreport.record(name, report).recorded, true, 'CONTROL: the report was recorded');
      assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'a hook noticing a turn is not evidence the account has room');
      assert.ok(chat.limitHeldVerdict(name, b.roster()), 'still held');
    } finally { b.done(); }
  });
}

test('#5805 Windows review 5 CONTROL: the agent\'s OWN fresh report still outranks the reading (#966)', () => {
  const b = box('winown', 'sid-own', 7200);
  try {
    b.pub.started(7200, 'sid-own');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    const until = Date.now() + 5;
    while (Date.now() < until) { /* the report comes strictly after the refusal */ }
    assert.equal(selfreport.record('winown', { state: 'working', on: 'a task' }).recorded, true);
    assert.notEqual(b.card().state, status.STATE.RATE_LIMITED, 'the agent says it is working, and it is the better witness');
  } finally { b.done(); }
});

test('#5805 Windows review 6: the agent\'s own report from BEFORE the refusal does not outrank it (it says nothing about now)', () => {
  const b = box('winbefore', 'sid-bef', 7300);
  try {
    b.pub.started(7300, 'sid-bef');
    assert.equal(selfreport.record('winbefore', { state: 'working', on: 'a task' }).recorded, true, 'CONTROL: reported while it still had room');
    const until = Date.now() + 5;
    while (Date.now() < until) { /* the refusal comes strictly after the report */ }
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'an older report cannot outrank the refusal that came after it');
    assert.ok(chat.limitHeldVerdict('winbefore', b.roster()), 'held');
  } finally { b.done(); }
});

test('#5805 Windows review 7: an operator clear (by operator) does not outrank the stream\'s limit', () => {
  const b = box('winop', 'sid-op', 7400);
  try {
    b.pub.started(7400, 'sid-op');
    b.pub.event(rejected(Math.floor(Date.now() / 1000) + 3600, 'five_hour'));
    const until = Date.now() + 5;
    while (Date.now() < until) { /* the clear comes after the refusal */ }
    assert.equal(selfreport.record('winop', { state: 'idle', by: 'operator' }).recorded, true, 'CONTROL: recorded');
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'an operator clear says nothing about the account');
  } finally { b.done(); }
});

test('#5805 Windows review 7: a refusal AFTER the agent\'s report wins, even the same refusal again', () => {
  const b = box('winrep', 'sid-rep', 7500);
  try {
    b.pub.started(7500, 'sid-rep');
    const reset = Math.floor(Date.now() / 1000) + 3600;
    b.pub.event(rejected(reset, 'five_hour'));
    let until = Date.now() + 5;
    while (Date.now() < until) { /* report after the first refusal */ }
    assert.equal(selfreport.record('winrep', { state: 'working', on: 'a task' }).recorded, true);
    assert.notEqual(b.card().state, status.STATE.RATE_LIMITED, 'CONTROL: the newer agent report wins at first');
    until = Date.now() + 5;
    while (Date.now() < until) { /* the same refusal comes again, later */ }
    b.pub.event(rejected(reset, 'five_hour'));
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'the latest refusal is newer than the report, so the account is capped now');
  } finally { b.done(); }
});
