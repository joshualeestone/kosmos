'use strict';
/**
 * #1765: the four report bridges (Codex, Gemini, Grok, Antigravity) send a token only to a listener that proves it
 * holds it (engine/boardproof.js). Each bridge's real send path runs here against real loopback servers, with the
 * bridge's own default fetch (no fetchImpl), so nothing the gate depends on is stubbed out:
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
        const out = prove ? boardproof.answer(Object.fromEntries(u.searchParams), () => [TOK], req.socket.localPort) : { status: 200, body: { proof: 'b'.repeat(64) } };
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
