'use strict';
/**
 * #5949 (root cause): every non-Claude Windows agent (Codex, Grok, Gemini, Antigravity) read "Can't tell" five
 * minutes after each turn. Its last report was the automatic "working" from the turn's start; its supervisor wrote
 * idle to its state file when the turn ended, but no idle report landed (Codex has no turn-end hook; the Gemini, Grok
 * and Antigravity bridges' own idle did not land on Josh's machine), and the board, once the working report went
 * stale, ignored the state file's idle for "we could not check".
 *
 * Pinned here:
 *   1. a normal turn end sends ONE automatic idle report (nothing on a failed turn, nothing while a message is queued,
 *      nothing when the agent's own hook already said idle during the turn)
 *   2. the real default sender posts `report idle --auto` to /api/report with the run's own token, proved in a child
 *      process (not --test) against a fake board on a random port, with a throwaway store root
 *   3. the board reads a Windows idle token over a stale working report (end to end through status.snapshot), and a
 *      Mac pane that merely looks idle still says it cannot tell
 *   4. an automatic idle never clears a standing blocked (what #5948's sign-in report relies on)
 *
 * No real board, agent or codex is touched.
 *
 *   node --test engine/win32codexsup.idle-5949.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const nodePath = require('node:path');
const { spawn } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'idle-5949-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { superviseCodexStreaming } = require('./win32codexsup');
const status = require('./status');
const selfreport = require('./selfreport');
const win32roster = require('./win32roster');
const win32capture = require('./win32capture');

function fakeStream() {
  const calls = [];
  return {
    calls,
    started(pid, sessionId) { calls.push(['started', pid, sessionId]); },
    event(e) { calls.push(['event', e && e.type]); },
    wrote() { calls.push(['wrote']); },
    stopped() { calls.push(['stopped']); },
    rekey(id) { calls.push(['rekey', id]); },
  };
}
function opts(over) {
  return Object.assign({
    stream: fakeStream(),
    prepare: () => ({ ok: true, sessionId: 'sess-1', name: 'coder', token: 'tok', instance: 'inst', tokenBecause: null, launchArgs: [] }),
    retireRun: () => ({ ok: true }),
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    supervisorPid: 4242,
    env: { CODEX_HOME: '/acct', KOSMOS_AGENT_TOKEN: 'abc123' },
    onEvent: () => {},
    lastReport: () => ({ found: false }),
  }, over || {});
}
const settle = () => new Promise((r) => setImmediate(r));

test('#5949 a turn that ends normally sends one automatic idle report, after its state file says idle', async () => {
  const stream = fakeStream();
  const sent = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    opts({ stream, runTurn: async () => ({ ok: true }), reportIdle: (env) => { sent.push({ env, at: stream.calls.length }); } }));
  h.send('hello');
  await settle(); await settle();
  assert.equal(sent.length, 1, 'one idle report for one turn');
  assert.deepEqual(stream.calls[sent[0].at - 1], ['event', 'result'], 'the state file went idle first');
  assert.equal(sent[0].env.KOSMOS_AGENT_TOKEN, 'abc123', 'sent with this run\'s own token (the turn environment)');
  h.stop();
});

test('#5949 when the agent\'s own hook already said idle during the turn, the supervisor does not say it again', async () => {
  const sent = [];
  let said = { found: false };
  const runTurn = async () => {
    said = { found: true, state: 'idle', at: new Date(Date.now() + 5).toISOString(), because: 'its own last words' };
    return { ok: true };
  };
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'gemini' },
    opts({ runTurn, lastReport: () => said, reportIdle: () => sent.push(1) }));
  h.send('hello');
  await settle(); await settle();
  assert.equal(sent.length, 0, 'the bridge\'s idle (with its last words) stands');
  /* An idle from BEFORE this turn is not this turn's: then the supervisor says it. */
  said = { found: true, state: 'idle', at: '2026-01-01T00:00:00Z', because: 'old' };
  const h2 = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'gemini' },
    opts({ runTurn: async () => ({ ok: true }), lastReport: () => said, reportIdle: () => sent.push(2) }));
  h2.send('hello');
  await settle(); await settle();
  assert.deepEqual(sent, [2]);
  /* A report it cannot read is not a reason to stay quiet. */
  const h3 = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'grok' },
    opts({ runTurn: async () => ({ ok: true }), lastReport: () => { throw new Error('torn'); }, reportIdle: () => sent.push(3) }));
  h3.send('hello');
  await settle(); await settle();
  assert.deepEqual(sent, [2, 3]);
  h.stop(); h2.stop(); h3.stop();
});

test('#5949 a failed turn sends no idle report (its own report is #5948\'s)', async () => {
  const sent = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    opts({ runTurn: async () => ({ ok: false, error: 'signed out' }), reportIdle: () => sent.push(1) }));
  h.send('hello');
  await settle(); await settle();
  assert.equal(sent.length, 0);
  h.stop();
});

test('#5949 a thrown turn sends no idle report', async () => {
  const sent = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    opts({ runTurn: async () => { throw new Error('boom'); }, reportIdle: () => sent.push(1) }));
  h.send('hello');
  await settle(); await settle();
  assert.equal(sent.length, 0);
  h.stop();
});

test('#5949 with a message queued behind the turn, idle is said only when the last turn ends', async () => {
  const sent = [];
  const order = [];
  let release;
  const first = new Promise((r) => { release = r; });
  let n = 0;
  const runTurn = async (o) => { n += 1; order.push('turn:' + o.message); if (n === 1) await first; return { ok: true }; };
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    opts({ runTurn, reportIdle: () => { sent.push(1); order.push('idle'); } }));
  h.send('one');
  await settle();
  h.send('two');   // arrives while turn one runs
  release();
  for (let i = 0; i < 6; i += 1) await settle();
  assert.deepEqual(order, ['turn:one', 'turn:two', 'idle'], 'no idle between the two turns');
  assert.equal(sent.length, 1);
  h.stop();
});

test('#5949 a sender that throws or rejects never stops the supervisor', async () => {
  for (const reportIdle of [() => { throw new Error('x'); }, () => Promise.reject(new Error('y'))]) {
    const turns = [];
    const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
      opts({ runTurn: async (o) => { turns.push(o.message); return { ok: true }; }, reportIdle }));
    h.send('a');
    await settle(); await settle();
    h.send('b');
    await settle(); await settle();
    assert.deepEqual(turns, ['a', 'b']);
    h.stop();
  }
});

test('#5949 the REAL default sender posts an automatic idle to /api/report with the run token (child process, fake board)', async () => {
  const got = [];
  const board = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      got.push({ url: req.url, method: req.method, agentToken: req.headers['x-kosmos-agent-token'], body: JSON.parse(body || '{}') });
      res.setHeader('content-type', 'application/json');
      res.end('{"recorded":true}');
    });
  });
  await new Promise((r) => board.listen(0, '127.0.0.1', r));
  const port = board.address().port;
  const childStore = nodePath.join(SANDBOX, 'child-data');
  /* Not a --test process, so the supervisor's default sender is live; everything else is a seam. */
  const script = `
    const { superviseCodexStreaming } = require(${JSON.stringify(nodePath.join(__dirname, 'win32codexsup'))});
    const h = superviseCodexStreaming({ name: 'coder', cwd: '.', runner: 'codex' }, {
      stream: { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} },
      prepare: () => ({ ok: true, sessionId: 'sess-1', token: 'abc123', instance: 'inst' }),
      retireRun: () => ({ ok: true }), sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
      env: Object.assign({}, process.env, { KOSMOS_PORT: ${JSON.stringify(String(port))}, KOSMOS_AGENT_TOKEN: 'abc123' }),
      runTurn: async () => ({ ok: true }),
    });
    h.send('hello');
    setTimeout(() => { h.stop(); }, 1500);
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: childStore, NODE_TEST_CONTEXT: '' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  await new Promise((r) => child.on('exit', r));
  await new Promise((r) => board.close(r));
  assert.equal(got.length, 1, 'one POST reached the fake board (child stderr: ' + err.slice(0, 300) + ')');
  assert.equal(got[0].method, 'POST');
  assert.equal(got[0].url, '/api/report');
  assert.equal(got[0].agentToken, 'abc123', 'the run\'s own agent token');
  assert.equal(got[0].body.state, 'idle');
  assert.equal(got[0].body.auto, true, 'an AUTOMATIC report, as Claude\'s Stop hook sends');
});

test('#5949 under node --test the default sender sends nothing (no suite can post to a real board)', async () => {
  const got = [];
  const board = http.createServer((req, res) => { got.push(req.url); res.end('{"recorded":true}'); });
  await new Promise((r) => board.listen(0, '127.0.0.1', r));
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    opts({ env: { KOSMOS_PORT: String(board.address().port), KOSMOS_AGENT_TOKEN: 'abc123' }, runTurn: async () => ({ ok: true }) }));
  h.send('hello');
  await new Promise((r) => setTimeout(r, 400));
  h.stop();
  await new Promise((r) => board.close(r));
  assert.deepEqual(got, []);
});

/* --- the board side --- */
const RECORD = { 'sid-c': { name: 'coder', runner: 'codex' } };
const rec = { read: () => RECORD };
const codexRow = { pid: 4242, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-c', name: 'coder', runner: 'codex' };

function onBoard(streamToken, fn) {
  /* The codex row rides the live list the capture joins (win32codexlive's own reader is tested on its own); it lists
     no status, so its token comes from the state file, here the injected streamState. */
  status.setPaneSource(win32roster.make({ run: () => [codexRow], record: rec, codexLive: () => [] }));
  status.setPaneCapture(win32capture.make({ run: () => [codexRow], record: rec, streamState: () => streamToken }));
  try { return fn(status.snapshot().agents.find((a) => a.sessionName === 'coder')); } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
}

function writeStaleWorking() {
  const r = selfreport.record('coder', { state: 'working', because: 'answering a prompt', auto: true });
  assert.equal(r.recorded, true, 'CONTROL: the working report was recorded');
  /* Age it past REPORT_WORKING_DECAY_MS, as six minutes of quiet would. */
  const file = selfreport.fileFor('coder');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  last.at = new Date(Date.now() - status.REPORT_WORKING_DECAY_MS - 60 * 1000).toISOString();
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

test('#5949 END TO END: a Windows agent whose state file says idle reads Idle once its working report is stale, not Can\'t tell', () => {
  writeStaleWorking();
  const card = onBoard('idle', (a) => a);
  assert.ok(card, 'the codex agent is on the board');
  assert.equal(card.state, status.STATE.IDLE, 'its supervisor said idle when the turn ended');
  const busy = onBoard('busy', (a) => a);
  assert.equal(busy.state, status.STATE.WORKING, 'CONTROL: a busy state file still reads working');
});

test('#5949 a Windows CLAUDE agent reading idle is not taken as idle over a stale working report (it reads idle while waiting)', () => {
  const claudeRecord = { read: () => ({ 'sid-k': { name: 'kai', runner: 'claude' } }) };
  const row = { pid: 7, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-k', name: 'kai', status: 'idle' };
  const r = selfreport.record('kai', { state: 'working', because: 'answering a prompt', auto: true });
  assert.equal(r.recorded, true);
  const file = selfreport.fileFor('kai');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  last.at = new Date(Date.now() - status.REPORT_WORKING_DECAY_MS - 60 * 1000).toISOString();
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  status.setPaneSource(win32roster.make({ run: () => [row], record: claudeRecord, codexLive: () => [] }));
  status.setPaneCapture(win32capture.make({ run: () => [row], record: claudeRecord }));
  try {
    const a = status.snapshot().agents.find((x) => x.sessionName === 'kai');
    assert.ok(a, 'the claude agent is on the board');
    assert.equal(a.state, status.STATE.UNKNOWN, 'unchanged for Claude');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#5949 a Mac pane that only LOOKS idle still says it cannot tell over a stale working report', () => {
  const stale = { found: true, state: 'working', at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), because: 'x' };
  const screenIdle = { state: status.STATE.IDLE, confidence: status.CONFIDENCE.SCRAPED, because: 'it is sitting at its prompt' };
  assert.equal(status.reconcileReport(stale, screenIdle, Date.now()).state, status.STATE.UNKNOWN);
  assert.equal(status.reconcileReport(stale, { ...screenIdle, liveToken: true }, Date.now()).state, status.STATE.IDLE,
    'CONTROL: the same report over a Windows idle token reads idle');
});

/* An existing selfreport rule, pinned here because #5948 relies on it and this change adds a sender of automatic idle. */
test('#5949 an automatic idle never clears a standing blocked (it composes with #5948\'s sign-in report)', () => {
  const b = selfreport.record('coder', { state: 'blocked', because: 'signed out of its account', on: 'sign-in', owner: 'person' });
  assert.equal(b.recorded, true, 'CONTROL: the blocked report was recorded (' + JSON.stringify(b) + ')');
  const idle = selfreport.record('coder', { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(idle.recorded, false, 'refused over the standing blocked');
  assert.equal(selfreport.read('coder').state, 'blocked');
});
