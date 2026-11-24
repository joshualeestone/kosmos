'use strict';
require('../test-support/tmpscope');
/**
 * kosmos#8979: when a Windows Claude agent's process dies and its supervisor starts it again, the card says when and
 * why, in plain words, until a turn on the new process ends well. The reason is read from the exit code, the signal and
 * the last error result #8967 keeps (by is_error, never by a `success` subtype).
 *
 *   node --test engine/restartcard-8979.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartcard-8979-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = path.join(SANDBOX, 'settings.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const ss = require('./win32streamstate');
const sup = require('./win32supervisor');
const status = require('./status');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const GOOD_TURN = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'text' }] } },
  { type: 'result', subtype: 'success', is_error: false },
];

function recording() {
  const wrote = [];
  const pub = ss.publisher('agent-a', { write: (rec) => { wrote.push(rec); return { ok: true }; }, clear: () => {}, setTimer: () => {} });
  return { pub, wrote, last: () => wrote[wrote.length - 1] };
}

test('#8979 restartWhy: the sign-in, the limit, Claude\'s own error, the signal, the exit code, in that order', () => {
  /* #8967's fact: Claude reports a sign-in failure as subtype "success" with is_error. */
  const signedOut = { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' };
  assert.equal(ss.restartWhy({ code: 1, errEvent: signedOut }), 'Claude is not signed in.');
  assert.equal(ss.restartWhy({ code: 1, auth: true }), 'Claude is not signed in.');
  assert.equal(ss.restartWhy({ code: 1, limited: true, errEvent: { type: 'result', subtype: 'success', is_error: true, result: 'x' } }), 'Claude reached its usage limit.');
  assert.equal(ss.restartWhy({ code: 1, errEvent: { type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' } }),
    'Claude stopped on an error: Credit balance is too low.', 'is_error read, the success subtype ignored');
  assert.equal(ss.restartWhy({ code: 1, errEvent: { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['a', 'b.'] } }),
    'Claude stopped on an error: a | b.');
  assert.equal(ss.restartWhy({ code: 1, errEvent: { type: 'result', subtype: 'error_max_turns' } }), 'Claude stopped on an error.');
  const long = ss.restartWhy({ code: 1, errEvent: { type: 'result', is_error: true, result: 'y'.repeat(1000) } });
  assert.ok(long.length < 'Claude stopped on an error: '.length + ss.RESTART_TEXT_MAX + 2, long.length + ' chars');
  assert.equal(ss.restartWhy({ code: 3221225477 }), 'Claude stopped unexpectedly (exit code 3221225477 = 0xC0000005).');
  assert.equal(ss.restartWhy({ code: 2 }), 'Claude stopped unexpectedly (exit code 2).');
  assert.equal(ss.restartWhy({ code: null, signal: 'SIGTERM' }), 'Claude was ended (signal SIGTERM).');
  assert.equal(ss.restartWhy({ code: 0 }), 'Claude stopped without saying why.');
  assert.equal(ss.restartWhy({}), 'Claude stopped without saying why.');
  assert.equal(ss.restartWhy(null), 'Claude stopped without saying why.');
  /* CONTROL: a successful result is the agent's reply, never a reason. */
  assert.equal(ss.restartWhy({ code: 2, errEvent: { type: 'result', subtype: 'success', is_error: false, result: 'private reply' } }),
    'Claude stopped unexpectedly (exit code 2).');
});

test('#8979 the restart rides on the NEXT process\'s record and stays until a turn there ends well', () => {
  const r = recording();
  r.pub.started(11, 's');
  assert.equal(r.last().restarted, undefined, 'CONTROL: a first start says no restart');
  r.pub.stopped();
  r.pub.restarting({ code: 3221225477, signal: null, errEvent: null });
  r.pub.started(12, 's');
  assert.equal(r.last().pid, 12);
  assert.equal(r.last().restarted.why, 'Claude stopped unexpectedly (exit code 3221225477 = 0xC0000005).');
  assert.ok(Number.isFinite(Date.parse(r.last().restarted.at)));
  /* An error turn does not clear it. */
  r.pub.wrote();
  r.pub.event({ type: 'system', subtype: 'init' });
  r.pub.event({ type: 'result', subtype: 'success', is_error: true, result: 'boom' });
  assert.ok(r.last().restarted, 'an error turn is not a good turn');
  /* A good turn does. */
  r.pub.wrote();
  for (const e of GOOD_TURN) r.pub.event(e);
  assert.equal(r.last().restarted, undefined, 'cleared on disk by a turn that ended well');
});

test('#8979 a local result that never reached the model does not clear it; a second death replaces it', () => {
  const r = recording();
  r.pub.started(11, 's');
  r.pub.stopped();
  r.pub.restarting({ code: 2 });
  r.pub.started(12, 's');
  r.pub.wrote();
  r.pub.event({ type: 'result', subtype: 'success', is_error: false });   // a local command: no assistant event
  assert.ok(r.last().restarted, 'a result with no model turn proves nothing');
  r.pub.stopped();
  r.pub.restarting({ code: null, signal: 'SIGKILL' });
  r.pub.started(13, 's');
  assert.equal(r.last().restarted.why, 'Claude was ended (signal SIGKILL).', 'the newest restart is the one said');
});

test('#8979 the sign-in and limit the ended process had shown are its reason', () => {
  const r = recording();
  r.pub.started(11, 's');
  r.pub.wrote();
  r.pub.event({ type: 'system', subtype: 'init' });
  r.pub.event({ type: 'assistant', error: 'authentication_failed', is_api_error_message: true, message: { content: [] } });
  r.pub.event({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, result: 'Invalid API key' });
  assert.ok(r.last().auth, 'precondition: the stream recorded the sign-in');
  r.pub.stopped();
  r.pub.restarting({ code: 1 });
  r.pub.started(12, 's');
  assert.equal(r.last().restarted.why, 'Claude is not signed in.');
});

test('#8979 a launch that did not spawn keeps the restart for the start that does', () => {
  const r = recording();
  r.pub.started(11, 's');
  r.pub.stopped();
  r.pub.restarting({ code: 2 });
  r.pub.started(null, null);
  r.pub.started(12, 's');
  assert.equal(r.last().restarted.why, 'Claude stopped unexpectedly (exit code 2).');
});

/* ── the supervisor ─────────────────────────────────────────────────────── */

function streamingChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.written = [];
  c.stdin = { destroyed: false, write: (s, cb) => { c.written.push(s); if (typeof cb === 'function') cb(null); }, end() { this.destroyed = true; } };
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  return c;
}
function sink() {
  const calls = [];
  return { calls, started: (...a) => calls.push(['started', ...a]), event() {}, wrote() {}, stopped: () => calls.push(['stopped']), rekey() {},
    restarting: (d) => calls.push(['restarting', d]) };
}
function run(feed, { restart = true } = {}) {
  const kids = [];
  const stream = sink();
  let pending = null;
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\\w' }, {
    liveReader: () => [], throttleMs: 0, now: () => 0,
    setTimer: (fn) => { pending = fn; },
    stream,
    launch: () => { const c = streamingChild(kids.length + 1); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  feed(kids[0], h);
  if (restart && pending) { const f = pending; pending = null; f(); }
  h.stop();
  return { calls: stream.calls, kids };
}

test('#8979 a death the supervisor restarts from is told to the publisher, with the error result itself', () => {
  const err = { type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' };
  const { calls, kids } = run((c) => {
    c.stdout.emit('data', Buffer.from(JSON.stringify(err) + '\n'));
    c.emit('exit', 1, null);
  });
  const said = calls.filter((x) => x[0] === 'restarting');
  assert.equal(said.length, 1, JSON.stringify(calls));
  assert.equal(said[0][1].code, 1);
  assert.deepEqual(said[0][1].errEvent, err);
  const order = calls.map((x) => x[0]);
  assert.ok(order.indexOf('restarting') > order.indexOf('stopped') && order.lastIndexOf('started') > order.indexOf('restarting'),
    'stopped, then restarting, then the next start: ' + order.join(','));
  assert.equal(kids.length, 2, 'precondition: it did restart');
});

test('#8979 a successful reply is never handed over as the reason, and a stop is never said as a restart', () => {
  const { calls } = run((c) => {
    c.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'private' }) + '\n'));
    c.emit('exit', 3221225477, null);
  });
  const said = calls.filter((x) => x[0] === 'restarting');
  assert.equal(said.length, 1);
  assert.equal(said[0][1].errEvent, null);
  assert.equal(said[0][1].code, 3221225477);

  const stopped = run((c, h) => { h.stop(); c.emit('exit', 0, null); }, { restart: false });
  assert.equal(stopped.calls.filter((x) => x[0] === 'restarting').length, 0, 'a deliberate stop is not a restart');
});

test('#8967 exitWords keeps its spelling now that it shares the card\'s', () => {
  assert.equal(sup.exitWords(3221225477, null), ' (exit code 3221225477 = 0xC0000005)');
  assert.equal(sup.exitWords(-1, null), ' (exit code -1 = 0xFFFFFFFF)');
  assert.equal(sup.exitWords(1, null), ' (exit code 1)');
  assert.equal(sup.exitWords(null, 'SIGTERM'), ' (signal SIGTERM)');
  assert.equal(sup.exitWords(null, null), '');
});

/* ── the card and the page ──────────────────────────────────────────────── */

test('#8979 the card carries it for a Windows Claude agent only, and only from a live process\'s file', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date(Date.now() - 5 * 60e3).toISOString();
  const file = path.join(dir, store.safeKey('hal') + '.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: process.pid, at, restarted: { at, why: 'Claude stopped unexpectedly (exit code 2).' } }));
  const win = { name: 'hal', command: 'claude.exe', runner: 'claude' };
  assert.deepEqual(status.restartedOf(win), { at, why: 'Claude stopped unexpectedly (exit code 2).' });
  assert.equal(status.restartedOf({ ...win, runner: 'codex' }), null, 'not another runner');
  assert.equal(status.restartedOf({ name: 'hal', command: 'claude' }), null, 'not a Mac pane');
  fs.writeFileSync(file, JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: 2147483646, at, restarted: { at, why: 'x' } }));
  assert.equal(status.restartedOf(win), null, 'a file its process outlived describes nothing running now');
  fs.writeFileSync(file, JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: process.pid, at }));
  assert.equal(status.restartedOf(win), null, 'CONTROL: no restart, nothing carried');
});

test('#8979 the page says "Restarted at <time>: <why>" on an idle or working card, and not over a sentence that matters more', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();
  const at = new Date();
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const restarted = { at: at.toISOString(), why: 'Claude is not signed in.' };
  for (const state of ['idle', 'working']) {
    assert.equal(stateReason({ name: 'Homer', state, restarted }), 'Restarted at ' + clock + ': Claude is not signed in.');
  }
  assert.notEqual(stateReason({ name: 'Homer', state: 'stopped', restarted }), 'Restarted at ' + clock + ': Claude is not signed in.');
  const crash = stateReason({ name: 'Homer', state: 'idle', restarted, crashLoop: { looping: true, count: 3 } });
  assert.match(crash, /^Kosmos has restarted it 3 times/, 'the crash loop says more');
  const old = new Date(Date.now() - 3 * 86400e3);
  assert.match(stateReason({ name: 'Homer', state: 'idle', restarted: { at: old.toISOString(), why: 'x.' } }),
    new RegExp('^Restarted at ' + old.toLocaleDateString([], { weekday: 'short' }) + ' '), 'another day names the day');
  assert.doesNotMatch(String(stateReason({ name: 'Homer', state: 'idle', restarted: { at: 'nope', why: 'x' } })), /^Restarted/);
  assert.doesNotMatch(String(stateReason({ name: 'Homer', state: 'idle', restarted: null })), /^Restarted/, 'CONTROL');
});
