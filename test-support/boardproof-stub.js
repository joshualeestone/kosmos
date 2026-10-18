'use strict';
/**
 * #1765: a stub board that answers the board proof, for tests whose stub stands in for the board.
 *
 * A report bridge sends a token only to a listener that proves it already holds it (engine/boardproof.js): it asks
 * GET /api/board-proof first, and a stub that answers that like any other request proves nothing, so the bridge
 * sends nothing and every test that reads the request goes red. This answers the proof the way a real board does,
 * for the tokens the stub is said to hold, and leaves every other request to the stub.
 *
 * `tokens` is what the stub holds: an array, or a function returning one (read per request, for a test that changes
 * the token it sends). A token it does not hold gets the board's own 404, so a test can still show a refusal.
 *
 * A stub given an agent token from the env holds it whether or not anything minted it, which a real board would not,
 * so do not use these stubs to show that an unminted agent token is refused: the squatter arms in
 * bridges.board-proof-1765.test.js are where refusal is tested.
 *
 * The proof request is answered BEFORE the stub sees it, so a stub that records requests records what it recorded
 * before the proof existed, and its counts and `seen[0]` reads stay as they were.
 *
 *   http.createServer((req, res) => { if (answerProof(req, res, ['tok'])) return; ... })
 *   main({ fetchImpl: withProof(recorder.fetchImpl, ['tok']) })
 */
const boardproof = require('../engine/boardproof');

const held = (tokens) => (typeof tokens === 'function' ? tokens() : tokens) || [];

function proofReply(url, tokens, port, addr) {
  const u = new URL(url, 'http://127.0.0.1');
  if (u.pathname !== boardproof.PROOF_PATH) return null;
  return boardproof.answer(Object.fromEntries(u.searchParams), () => held(tokens), port, addr);
}

/* For an http stub: true when it answered (the proof route), false to let the stub handle the request. The port and
   address are the ones this socket was dialled on, as the board's own answer uses. */
function answerProof(req, res, tokens) {
  const out = proofReply(req.url, tokens, req.socket.localPort, req.socket.localAddress);
  if (!out) return false;
  res.writeHead(out.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out.body));
  return true;
}

/* For an injected fetch: proof requests answered here, everything else passed to `fetchImpl`, which never sees them. */
function withProof(fetchImpl, tokens) {
  return async (url, init) => {
    const u = new URL(String(url));
    const out = proofReply(String(url), tokens, boardproof.portOf(u), u.hostname);   // the address the sender dialled
    if (!out) return fetchImpl(url, init);
    const text = JSON.stringify(out.body);
    return { ok: out.status === 200, status: out.status, text: async () => text, json: async () => JSON.parse(text) };
  };
}

/* What a real board holds: the board token in its data root (when it wrote one) and the agent tokens it minted. For a
   stub standing in for the board a bridge was launched against, from the same data root and agent token. */
function boardTokens(dataRoot, ...agentTokens) {
  const out = agentTokens.filter((t) => typeof t === 'string' && t);
  if (dataRoot) {
    try {
      const t = require('node:fs').readFileSync(require('node:path').join(dataRoot, require('../engine/store').APP, 'board.token'), 'utf8').trim();
      if (t) out.unshift(t);
    } catch { /* no board token written: the stub holds only the agent tokens */ }
  }
  return out;
}

/* The agent tokens Kosmos minted under `dataRoot` (engine/sendertoken), as the board reads them, for a stub standing in
   for the board a supervisor minted a launch token against. In a child, because sendertoken's folder is fixed from
   AGENT_WORKFORCE_DATA when it loads, and this process's is not the stub's. */
function mintedTokens(dataRoot) {
  const r = require('node:child_process').spawnSync(process.execPath, ['-e',
    'process.stdout.write(JSON.stringify(require(process.argv[1]).heldValues()))',
    require('node:path').join(__dirname, '..', 'engine', 'sendertoken.js')],
  { env: { ...process.env, AGENT_WORKFORCE_DATA: dataRoot }, encoding: 'utf8', timeout: 10000 });
  try { return JSON.parse(r.stdout); } catch { return []; }
}

module.exports = { answerProof, withProof, boardTokens, mintedTokens };
