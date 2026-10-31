'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits
/**
 * #7369 (Windows): a Claude agent whose sign-in stopped working reads "Sign-in Issue" on its card (auth_failed, read
 * from its own stream, never reported), its messages are held rather than typed into a session that answers every turn
 * "Not logged in", and the hold lets go once the account's live check reads it signed in again, with no turn needed.
 *
 * Before this, a turn refused for the sign-in ended in a `result` that win32streamstate read as idle, so the card said
 * nothing and every message counted as delivered (a user went 5 days, #7366). These drive the REAL publisher writing a
 * REAL state file, read through the REAL roster, capture, status.snapshot() and chat hold, as win32limit-5805 does. The
 * result's words are Claude Code's own, read from the installed binary on the Windows box (2026-10-27).
 *
 *   node --test engine/win32authfail-7369.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32authfail-7369-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const status = require('./status');
const chat = require('./chat');
const create = require('./create');
const authprobe = require('./authprobe');
const subscription = require('./subscription');
const win32capture = require('./win32capture');
const win32roster = require('./win32roster');
const win32streamstate = require('./win32streamstate');

const NOT_LOGGED_IN = 'Not logged in · Please run /login';
const LIMIT_SENTENCE = "You've hit your weekly limit. Your limit resets Oct 21, 3pm (America/Chicago).";
const streaming = (sessionId, pid, name) => ({ pid, cwd: 'C:\\w', kind: 'interactive', startedAt: 1, sessionId, name });
const recordOf = (map) => ({ read: () => map });
/* A refused turn, as Claude Code streams it: the error as an assistant message flagged is_api_error_message, then a
   result with is_error and the same sentence. */
function signedOutTurn(pub, sentence) {
  pub.wrote();
  pub.event({ type: 'system', subtype: 'init' });
  pub.event({ type: 'assistant', message: { content: [{ type: 'text', text: sentence }] }, is_api_error_message: true });
  pub.event({ type: 'result', subtype: 'success', is_error: true, result: sentence });
}
function goodTurn(pub) {
  pub.wrote();
  pub.event({ type: 'system', subtype: 'init' });
  pub.event({ type: 'assistant', message: { content: [] } });
  pub.event({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
}

/* The account side: a Kosmos job on the default Claude account (what create.readJob returns for an agent it made), and
   `claude auth status` answering as `live` says. Restored by done(). */
function account(live) {
  const realRead = create.readJob;
  let answer = live;
  create.readJob = () => ({ configDir: null });
  authprobe.resetForTest();
  authprobe.setChecker(async () => ({ state: answer }));
  return {
    set(next) { answer = next; authprobe.resetForTest(); },
    restore() { create.readJob = realRead; authprobe.resetForTest(); authprobe.setChecker(async () => ({ state: subscription.STATE.UNKNOWN })); },
  };
}

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
/* authprobe is async off the tick: one look kicks the check, the settled answer is read on a later look. */
const settle = () => new Promise((r) => setImmediate(r));

test('#7369 Windows: a turn refused for the sign-in reads auth_failed (screen class, not reported), with Claude\'s sentence', () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winsignin', 'sid-a1', 8001);
  try {
    b.pub.started(8001, 'sid-a1');
    assert.equal(b.card().state, status.STATE.IDLE, 'CONTROL: started, idle');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    const c = b.card();
    assert.equal(c.state, status.STATE.AUTH_FAILED, 'signed out, not idle: ' + JSON.stringify(c.state));
    assert.notEqual(c.stateReported, true, 'the Mac\'s screen-read shape: read, never reported');
    assert.equal(c.stateEvidence, NOT_LOGGED_IN, 'Claude\'s own sentence rides along');
  } finally { b.done(); acct.restore(); }
});

for (const sentence of ['Invalid API key · Please run /login', 'OAuth token revoked · Please run /login',
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}']) {
  test('#7369 Windows: the other sign-in sentences read auth_failed too (' + sentence.slice(0, 24) + ')', () => {
    const b = box('winsignin2', 'sid-a2', 8002);
    try {
      b.pub.started(8002, 'sid-a2');
      signedOutTurn(b.pub, sentence);
      assert.equal(b.card().state, status.STATE.AUTH_FAILED);
    } finally { b.done(); }
  });
}

test('#7369 Windows CONTROLS: a usage-limit refusal still reads rate_limited, and an ordinary error or a good turn reads idle', () => {
  const b = box('winctl', 'sid-a3', 8003);
  try {
    b.pub.started(8003, 'sid-a3');
    b.pub.wrote();
    b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'seven_day', isUsingOverage: false } });
    b.pub.event({ type: 'result', subtype: 'success', is_error: true, result: LIMIT_SENTENCE });
    assert.equal(b.card().state, status.STATE.RATE_LIMITED, 'the #5805 path is unchanged');
    b.pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
    /* An error that is not the sign-in (and not the limit): a turn cut off for another reason. */
    b.pub.wrote();
    b.pub.event({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Tool execution failed: ENOENT' });
    assert.equal(b.card().state, status.STATE.IDLE, 'an ordinary error is not a sign-in');
    goodTurn(b.pub);
    assert.equal(b.card().state, status.STATE.IDLE, 'a normal result is idle');
  } finally { b.done(); }
});

test('#7369 Windows: a later turn that reached the model and succeeded clears it; a local command does not', () => {
  const b = box('winclear', 'sid-a4', 8004);
  try {
    b.pub.started(8004, 'sid-a4');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: signed out first');
    /* A local command (no assistant message) ends without an error: it made no API request, so it says nothing. */
    b.pub.wrote();
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: '' });
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'a turn that never reached the model must not clear it');
    goodTurn(b.pub);
    assert.equal(b.card().state, status.STATE.IDLE, 'a good turn clears it');
  } finally { b.done(); }
});

test('#7369 Windows: messages are held in Claude\'s words while it reads signed out; CONTROL: not held once it is idle', async () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winhold', 'sid-a5', 8005);
  try {
    b.pub.started(8005, 'sid-a5');
    assert.equal(chat.signinHeldVerdict('winhold', b.roster()), null, 'CONTROL: an idle Claude card is not held');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    b.roster();   // review 1: the hold waits for the account check's answer; one look kicks it
    await settle();
    const v = chat.signinHeldVerdict('winhold', b.roster());
    assert.ok(v && v.held === true && v.heldBy === 'limit' && v.heldFor === 'signin', JSON.stringify(v));
    assert.equal(v.because, 'held: it is signed out of Claude; Kosmos sends it once it is signed in again');
    const acc = chat.accountHeldVerdict('winhold', b.roster());
    assert.ok(acc && acc.heldFor === 'signin', 'the delivery path\'s own check holds it too: ' + JSON.stringify(acc));
  } finally { b.done(); acct.restore(); }
});

test('#7369 Windows: the hold lets go when the live check reads it signed in again, with no turn (no deadlock)', async () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winrelease', 'sid-a6', 8006);
  try {
    b.pub.started(8006, 'sid-a6');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    b.roster();   // kicks the check
    await settle();
    let card = b.card();
    assert.equal(card.state, status.STATE.AUTH_FAILED, 'the check reads signed out: it stands');
    assert.equal(chat.limitQueueReleased(card, b.roster()), false, 'the queue is kept while it reads signed out');
    acct.set(subscription.STATE.CONNECTED);   // the person signs in; nothing is typed to the agent
    b.roster();
    await settle();
    card = b.card();
    assert.equal(card.state, status.STATE.IDLE, 'signed in again: the plain state under it, not "can\'t tell": ' + JSON.stringify(card.state));
    assert.equal(chat.signinHeldVerdict('winrelease', b.roster()), null);
    assert.equal(chat.limitQueueReleased(card, b.roster()), true, 'the queue is let go');
  } finally { b.done(); acct.restore(); }
});

test('#7369 Windows: a Claude agent with no Kosmos job (nothing the live check could ask about) is shown, not held', () => {
  const realRead = create.readJob;
  create.readJob = () => null;
  const b = box('winnojob', 'sid-a7', 8007);
  try {
    b.pub.started(8007, 'sid-a7');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: it reads signed out');
    assert.equal(chat.signinHeldVerdict('winnojob', b.roster()), null, 'a hold nothing could release would keep messages for a day');
  } finally { b.done(); create.readJob = realRead; }
});

test('#7369 Windows: the token round-trips through the state file (stateFor), after a limit and before the plain state', () => {
  const name = 'wintoken';
  const pub = win32streamstate.publisher(name);
  try {
    pub.started(process.pid, 'sid-t');
    const live = { sessionId: 'sid-t', pid: process.pid };
    assert.equal(win32streamstate.stateFor(name, live), 'idle');
    signedOutTurn(pub, NOT_LOGGED_IN);
    const tok = win32streamstate.stateFor(name, live);
    assert.match(tok, /^auth \S+ idle Not logged in · Please run \/login$/);
    assert.equal(win32streamstate.isAuthToken(tok), true);
    assert.equal(win32streamstate.isAuthToken('idle'), false, 'CONTROL');
    assert.equal(win32streamstate.isLimitToken(tok), false, 'CONTROL: not the limit token');
    pub.event({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'five_hour' } });
    assert.match(win32streamstate.stateFor(name, live), /^limit /, 'out of usage reads first, as on the Mac');
  } finally { pub.stopped(); }
});

test('#7369 review 1 CONTROLS: an agent QUOTING a sign-in error in its reply, and an error result about tokens, never read signed out', () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winquote', 'sid-a9', 8009);
  try {
    b.pub.started(8009, 'sid-a9');
    // The agent's own prose (debugging someone's auth) ends in a good result.
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'assistant', message: { content: [{ type: 'text', text: 'The log says: Invalid API key · Please run /login (401)' }] } });
    b.pub.event({ type: 'result', subtype: 'success', is_error: false, result: 'The log says: Invalid API key · Please run /login (401)' });
    assert.notEqual(b.card().state, status.STATE.AUTH_FAILED, 'quoted words in a good turn are not a sign-out');
    // An error result for another reason that mentions tokens.
    b.pub.wrote();
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 400 prompt is too long: 210000 tokens > 200000 maximum' });
    assert.notEqual(b.card().state, status.STATE.AUTH_FAILED, 'a 400 about tokens is not a sign-out');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: the same box does read a real sign-out');
  } finally { b.done(); acct.restore(); }
});

test('#7369 review 2: once cleared, the same refusal does not flicker back while the check is re-asked; a NEW refusal shows', async () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winflap', 'sid-b1', 8101);
  try {
    b.pub.started(8101, 'sid-b1');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    b.roster();
    await settle();
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: signed out');
    acct.set(subscription.STATE.CONNECTED);
    b.roster();
    await settle();
    assert.equal(b.card().state, status.STATE.IDLE, 'CONTROL: signed in again, idle');
    authprobe.resetForTest();
    authprobe.setChecker(() => new Promise(() => {}));   // the 30 s re-check, not answered yet: UNCHECKED
    assert.equal(b.card().state, status.STATE.IDLE, 'no flicker back to Sign-in Issue while the check is re-asked');
    await new Promise((r) => setTimeout(r, 5));
    signedOutTurn(b.pub, NOT_LOGGED_IN);   // a new refusal, a new since
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: a new refusal still shows');
  } finally { b.done(); acct.restore(); }
});

test('#7369 review 3: a still-fresh HEALTHY from BEFORE a new refusal does not clear it for good; the next check shows and holds it', async () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winrace', 'sid-b2', 8102);
  try {
    b.pub.started(8102, 'sid-b2');
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    b.roster();
    await settle();
    acct.set(subscription.STATE.CONNECTED);
    b.roster();
    await settle();
    assert.equal(b.card().state, status.STATE.IDLE, 'CONTROL: signed in again, cleared');
    // Signed out again while that HEALTHY is still cached (inside its 30 s): the account now answers signed out.
    authprobe.setChecker(async () => ({ state: subscription.STATE.NONE }));
    await new Promise((r) => setTimeout(r, 5));
    signedOutTurn(b.pub, NOT_LOGGED_IN);
    b.card();   // a tick under the old, fresh HEALTHY: the bounded false calm authprobe already accepts
    authprobe.resetForTest();   // the cache entry ages out; the next look asks again
    b.roster();
    await settle();
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'the check asked after the refusal shows it: not hidden for good');
    const v = chat.signinHeldVerdict('winrace', b.roster());
    assert.ok(v && v.heldFor === 'signin', 'and messages are held: ' + JSON.stringify(v));
  } finally { b.done(); acct.restore(); }
});

/* Review 4: the shape the installed Claude Code really sends when signed out (captured on the Windows box): the refused
   assistant message carries error "authentication_failed", the result api_error_status (null for "Not logged in"). */
function realShapeTurn(pub, sentence, { assistantError = 'authentication_failed', status = null } = {}) {
  pub.wrote();
  pub.event({ type: 'system', subtype: 'init' });
  pub.event({ type: 'assistant', message: { content: [{ type: 'text', text: sentence }] }, is_api_error_message: true, ...(assistantError ? { error: assistantError } : {}) });
  pub.event({ type: 'result', subtype: 'success', is_error: true, result: sentence, api_error_status: status });
}

test('#7369 review 4: the real signed-out shape reads signed out even in words the phrase list does not know; CONTROLS', () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winreal', 'sid-c1', 8201);
  try {
    b.pub.started(8201, 'sid-c1');
    realShapeTurn(b.pub, 'Some future wording for a lapsed sign-in', { assistantError: null });
    assert.notEqual(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: unknown words with no marker are not a sign-out');
    realShapeTurn(b.pub, 'Some future wording for a lapsed sign-in');
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'the assistant\'s authentication_failed marks it');
    goodTurn(b.pub);
    assert.notEqual(b.card().state, status.STATE.AUTH_FAILED, 'a good turn clears it');
    realShapeTurn(b.pub, 'Some future wording', { assistantError: null, status: 401 });
    assert.equal(b.card().state, status.STATE.AUTH_FAILED, 'api_error_status 401 marks it');
    goodTurn(b.pub);
    realShapeTurn(b.pub, 'API Error: 429 rate limited later', { assistantError: null, status: 429 });
    assert.notEqual(b.card().state, status.STATE.AUTH_FAILED, 'CONTROL: another status is not a sign-out');
  } finally { b.done(); acct.restore(); }
});

test('#7369 review 4: an API-key account (key file in its folder) is shown signed out but never held: its check cannot tell', () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-keyacct-'));
  fs.writeFileSync(require('./claudeaccounts').keyFile(dir), 'sk-ant-test');
  const realRead = create.readJob;
  create.readJob = () => ({ configDir: dir });
  try {
    assert.equal(status.claudeSignedOutConfirmed('anyone', undefined, () => require('./authprobe').EXPIRED), false, 'a key account is not checkable');
    assert.equal(status.claudeSignedOutConfirmed('anyone', () => ({ configDir: dir }), () => authprobe.EXPIRED), false, 'nor ever confirmed');
    fs.rmSync(require('./claudeaccounts').keyFile(dir));
    assert.equal(status.claudeSignedOutConfirmed('anyone', undefined, () => require('./authprobe').EXPIRED), true, 'CONTROL: the same folder without a key file is checkable');
  } finally { create.readJob = realRead; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7369 review 5: a refusal\'s flag ends with its turn: a next turn with no write that fails for another reason is not a new refusal', async () => {
  const acct = account(subscription.STATE.NONE);
  const b = box('winflag', 'sid-c2', 8202);
  const live = { sessionId: 'sid-c2', pid: 8202 };
  try {
    b.pub.started(8202, 'sid-c2');
    realShapeTurn(b.pub, 'Some future wording for a lapsed sign-in');
    const first = win32streamstate.stateFor('winflag', live);
    assert.match(first, /^auth \S+ \w+ Some future wording/,'CONTROL: the refusal is recorded: ' + first);
    await new Promise((r) => setTimeout(r, 5));
    // A turn that began with no write (a wake-up) and ended on a server error.
    b.pub.event({ type: 'system', subtype: 'init' });
    b.pub.event({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 500 Internal server error', api_error_status: 500 });
    const after = win32streamstate.stateFor('winflag', live);
    assert.equal(after.split(' ')[1], first.split(' ')[1], 'the 500 was not stamped as a new refusal');
    assert.doesNotMatch(after, /API Error: 500/, 'nor carries the 500 as the sign-in sentence');
  } finally { b.done(); acct.restore(); }
});
