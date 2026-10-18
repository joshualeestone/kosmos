'use strict';
/**
 * #1765: the four report bridges (Codex, Gemini, Grok, Antigravity) send a token only to a listener that proves it
 * holds it (engine/boardproof.js). Each bridge's real send path runs here against real loopback servers, with the
 * bridge's own default fetch (no fetchImpl), so the gate, the fetch and the listener are all real; the Codex, Gemini
 * and Grok keep arms give the headers through a seam (headers, readBoardToken) rather than reading them:
 *   - a squatter that answers every request, the proof route included: no token-bearing request may arrive;
 *   - CONTROL, a listener that holds the token and answers the proof: the token-bearing request arrives, so the
 *     squatter arm's "nothing arrived" is a real negative.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
/* The Antigravity bridge reads the board token from the store itself: a sandboxed data root holding TOK, set before
   anything loads engine/store, so the live board's token is never read here. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bridges-boardproof-1765-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const boardproof = require('./engine/boardproof');

const TOK = 'board-tok-bridges-1765';
const ROOT = require('./engine/store').ROOT;
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'board.token'), TOK + '\n', { mode: 0o600 });

function listener(prove) {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const u = new URL(req.url, 'http://x');
      if (u.pathname === boardproof.PROOF_PATH) {
        const out = prove ? boardproof.answer(Object.fromEntries(u.searchParams), () => [TOK], req.socket.localPort, req.socket.localAddress) : { status: 200, body: { proof: 'b'.repeat(64) } };
        res.writeHead(out.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out.body));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true,"recorded":true}');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, seen, port: String(server.address().port) })));
}
const carried = (seen) => seen.filter((r) => r.headers['x-kosmos-board-token'] === TOK);

const SENDS = {
  codex: (port) => require('./bin/codex-report-bridge.js').hookMain({
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: '/w', session_id: 's', tool_input: { command: '*** Add File: a\n' } }),
    env: { KOSMOS_PORT: port }, headers: { 'x-kosmos-board-token': TOK } }),
  gemini: (port) => require('./bin/gemini-report-bridge.js').main({
    input: JSON.stringify({ hook_event_name: 'AfterAgent', session_id: 's' }), env: { KOSMOS_PORT: port }, readBoardToken: () => TOK }),
  grok: (port) => require('./bin/grok-report-bridge.js').main({
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), env: { KOSMOS_PORT: port }, readBoardToken: () => TOK }),
  agy: (port) => require('./bin/agy-report-bridge.js').postKeep({ path: '/w/a', cwd: '/w', session: 's' }, { KOSMOS_PORT: port }),
};

for (const [name, send] of Object.entries(SENDS)) {
  test(`#1765 ${name}: a squatter on the port receives no token`, async () => {
    const l = await listener(false);
    try { await send(l.port); } finally { l.server.close(); }
    assert.ok(l.seen.some((r) => r.url.startsWith(boardproof.PROOF_PATH + '?')), `${name} never asked for a proof`);
    assert.equal(carried(l.seen).length, 0, `${name} sent the token to a squatter`);
  });
  test(`#1765 ${name} CONTROL: a listener holding the token receives it`, async () => {
    const l = await listener(true);
    try { await send(l.port); } finally { l.server.close(); }
    assert.ok(carried(l.seen).length > 0, `${name} did not send to the proven board, so its squatter arm proves nothing`);
  });
}

/* Review 1 (W2): each bridge's report path, run the way its CLI runs it (a child process), so a gate removed from
   those paths turns red too: Codex's notify report (the turn as argv) and Antigravity's report (the event as argv,
   the payload on stdin). Each child gets its own pane, so the Antigravity throttle never swallows a run, and no agent
   token, so nothing from the machine running the tests reaches either listener. */
const { spawn } = require('node:child_process');
let paneNo = 0;
function runChild(args, port, stdin) {
  return new Promise((resolve) => {
    const env = { ...process.env, KOSMOS_PORT: port, KOSMOS_AGENT_TOKEN: '', KOSMOS_AGENT_TOKEN_ONLY: '', TMUX_PANE: `%bp1765-${process.pid}-${paneNo++}` };
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', resolve);
    child.on('error', resolve);
    child.stdin.end(stdin || '');
  });
}
const REPORTS = {
  'codex notify': (port) => runChild([path.join(__dirname, 'bin', 'codex-report-bridge.js'),
    JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 't', 'turn-id': 'u', cwd: '/x', 'input-messages': ['go'], 'last-assistant-message': 'done' })], port),
  'agy report': (port) => runChild([path.join(__dirname, 'bin', 'agy-report-bridge.js'), 'Stop'], port, JSON.stringify({ fullyIdle: true })),
};
for (const [name, send] of Object.entries(REPORTS)) {
  test(`#1765 ${name}: a squatter on the port receives no token`, async () => {
    const l = await listener(false);
    try { await send(l.port); } finally { l.server.close(); }
    assert.ok(l.seen.some((r) => r.url.startsWith(boardproof.PROOF_PATH + '?')), `${name} never asked for a proof`);
    assert.equal(carried(l.seen).length, 0, `${name} sent the token to a squatter`);
  });
  test(`#1765 ${name} CONTROL: a listener holding the token receives it`, async () => {
    const l = await listener(true);
    try { await send(l.port); } finally { l.server.close(); }
    assert.ok(carried(l.seen).some((r) => r.url === '/api/report'), `${name} did not report to the proven board, so its squatter arm proves nothing`);
  });
}

/* Review 1 (W1): the proof never adds to a hook's bound. A board that proves itself slowly (just under half the
   bound) and then never answers the keep must still let the hook go within the bound: before the shared deadline
   it held the hook for the proof plus the whole keep bound. CONTROL: the keep is attempted (the proof passed), so
   the elapsed time is the keep's wait, not a refusal that returned early. */
function slowProofFetch(delayMs, sent) {
  return async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === boardproof.PROOF_PATH) {
      await new Promise((r) => setTimeout(r, delayMs));
      const out = boardproof.answer(Object.fromEntries(u.searchParams), () => [TOK], boardproof.portOf(u), u.hostname);
      const text = JSON.stringify(out.body);
      return { ok: out.status === 200, status: out.status, text: async () => text, json: async () => out.body };
    }
    sent.push(u.pathname);
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
}
const KEEPS = {
  gemini: { bound: 800, run: (fetchImpl) => require('./bin/gemini-report-bridge.js').main({ fetchImpl, keepTimeoutMs: 800, readBoardToken: () => TOK,
    env: { KOSMOS_PORT: '16999', KOSMOS_AGENT_TOKEN: '' },
    input: JSON.stringify({ hook_event_name: 'BeforeTool', session_id: 's', cwd: '/w', tool_name: 'write_file', tool_input: { file_path: '/w/a' } }) }) },
  grok: { bound: 800, run: (fetchImpl) => require('./bin/grok-report-bridge.js').main({ fetchImpl, keepTimeoutMs: 800, readBoardToken: () => TOK,
    env: { KOSMOS_PORT: '16999', KOSMOS_AGENT_TOKEN: '' },
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', cwd: '/w', tool_name: 'write', tool_input: { file_path: '/w/a' } }) }) },
  codex: { bound: 800, run: (fetchImpl) => require('./bin/codex-report-bridge.js').hookMain({ fetchImpl, keepTimeoutMs: 800, headers: { 'x-kosmos-board-token': TOK },
    env: { KOSMOS_PORT: '16999' },
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: '/w', session_id: 's', tool_input: { command: '*** Add File: a\n' } }) }) },
  // agy's keep bound is its constant (3000 ms): no seam shortens it, so this arm takes about 3 s.
  agy: { bound: require('./bin/agy-report-bridge.js').KEEP_TIMEOUT_MS,
    run: (fetchImpl) => require('./bin/agy-report-bridge.js').postKeep({ path: '/w/a', cwd: '/w', session: 's' }, { KOSMOS_PORT: '16999' }, fetchImpl) },
};
for (const [name, k] of Object.entries(KEEPS)) {
  test(`#1765 ${name}: a slow proof and a stalled keep still end within the keep's bound`, async () => {
    const sent = [];
    const started = Date.now();
    await k.run(slowProofFetch(Math.floor(k.bound * 0.45), sent));
    const took = Date.now() - started;
    assert.ok(sent.includes('/api/undo/keep'), `${name} never attempted the keep, so the timing below measures a refusal`);
    assert.ok(took <= k.bound + 250, `${name} held the hook ${took} ms against a ${k.bound} ms bound`);
  });
}

/* Review 3 (W2): the same bound on the two report paths, which keep their own deadline code. A board that proves
   itself just under half the report's bound and then never answers the report must still let the child go within
   the bound. CONTROL: the report was attempted, so the time is the report's wait, not an early refusal. */
function slowProofListener(delayMs) {
  const seen = [];
  const at = {};   // when the proof was asked for: the bridge's deadline starts just before it
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u.pathname);
    if (u.pathname === boardproof.PROOF_PATH && at.proof === undefined) at.proof = Date.now();
    if (u.pathname !== boardproof.PROOF_PATH) return;   // the report: never answered
    setTimeout(() => {
      const out = boardproof.answer(Object.fromEntries(u.searchParams), () => [TOK], req.socket.localPort, req.socket.localAddress);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    }, delayMs);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, seen, at, port: String(server.address().port) })));
}
const REPORT_BOUNDS = {
  'codex notify': require('./bin/codex-report-bridge.js').TIMEOUT_MS,
  'agy report': require('./bin/agy-report-bridge.js').TIMEOUT_MS,
};
for (const [name, send] of Object.entries(REPORTS)) {
  test(`#1765 ${name}: a slow proof and a stalled report still end within the report's bound`, async () => {
    const bound = REPORT_BOUNDS[name];
    // 0.4, not 0.45: the proof's own cutoff is half the bound, and a real listener's answer needs room under it on a
    // loaded machine (review 5); the old timing still lands well past the threshold.
    const l = await slowProofListener(Math.floor(bound * 0.4));
    try { await send(l.port); } finally { l.server.closeAllConnections(); l.server.close(); }
    const ended = Date.now();
    assert.ok(l.seen.includes('/api/report'), `${name} never attempted the report, so the timing below measures a refusal`);
    /* Timed from the proof request, not the spawn (review 4): a child's start-up under load is not the bound. The
       margin covers the child's exit after the abort. */
    const took = ended - l.at.proof;
    assert.ok(took <= bound * 1.15, `${name} held its CLI ${took} ms after asking for the proof, against a ${bound} ms bound`);
  });
}
