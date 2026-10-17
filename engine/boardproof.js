'use strict';
/* #1765: the board proves it is THIS account's board before any client sends it a token.

   Every client finds the board by a loopback port. Another account on the same machine can listen on that
   port whenever the board is not (at login before the board starts, during an update restart, after a crash),
   and a client that sends its token to whatever answers hands the token to that listener. So a client asks
   first: it sends a fresh random nonce and a short key id for the token it holds, and only a listener that
   already holds that same token can answer with HMAC-SHA256(token, nonce). The client checks the answer
   with its own copy and sends the token only when it matches.

   The key id is a hash prefix, so the request carries nothing a listener can use to authenticate. A real
   board answers for any nonce, but a fresh 128-bit client nonce makes a stored answer useless. The proof is
   bound to the port: the client puts the port it dialled in the message and the board the port it listens on,
   so a listener on this port cannot pass on an answer from a board listening on another one (a second install,
   or a board started on a different port). The proof and the request that follows are two connections: a board
   that stops between them and a listener that takes the port in that gap is a window this does not close.

   Shared by the board (answer) and every node client (check). The CLI fetches the proof with its own curl (the
   same route and time limit as its request) and runs this file only for the arithmetic:
     printf '%s' "$token" | node boardproof.js --key                       prints the key id
     printf '%s\n%s\n%s' "$token" "$nonce" "$answer" | node boardproof.js --verify <base url>   exit 0 proven, 1 not
   The token comes on stdin, never argv, which `ps` shows to every account. */
const crypto = require('crypto');
const http = require('http');

const PROOF_PATH = '/api/board-proof';
const NONCE_RE = /^[0-9a-f]{32}$/;
const KEY_ID_RE = /^[0-9a-f]{16}$/;

function keyId(token) {
  return crypto.createHash('sha256').update('kosmos-board-proof-key\0' + String(token)).digest('hex').slice(0, 16);
}
function proof(token, nonce, port) {
  return crypto.createHmac('sha256', String(token)).update('kosmos-board-proof\0' + String(port) + '\0' + String(nonce)).digest('hex');
}
function newNonce() { return crypto.randomBytes(16).toString('hex'); }
function proofMatches(token, nonce, answer, port) {
  if (typeof answer !== 'string' || !/^[0-9a-f]{64}$/.test(answer)) return false;
  const want = Buffer.from(proof(token, nonce, port), 'hex');
  const got = Buffer.from(answer, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* The board's side. `candidates` returns an iterable of the tokens this board holds, cheapest first (a generator,
   so the agent-token files are read only when no board token matched). Called only for a well-formed request.
   `port` is the port this board listens on. Returns { status, body }. */
function answer(query, candidates, port) {
  const n = query && query.n, k = query && query.k;
  if (typeof n !== 'string' || !NONCE_RE.test(n) || typeof k !== 'string' || !KEY_ID_RE.test(k)) {
    return { status: 400, body: { error: 'a board proof needs n (32 hex) and k (16 hex)' } };
  }
  try {
    for (const t of candidates() || []) {
      if (typeof t === 'string' && t && keyId(t) === k) return { status: 200, body: { proof: proof(t, n, port) } };
    }
  } catch { /* an unreadable store proves nothing */ }
  return { status: 404, body: { error: 'this board holds no token with that key id' } };
}

/* The client's side: does the listener at baseUrl hold `token`? Resolves true or false, never throws.
   Loopback http only; anything else is false, because no client of this module talks to anything else. */
function portOf(u) { return u.port || '80'; }

function boardHoldsToken(baseUrl, token, opts = {}) {
  const timeoutMs = opts.timeoutMs || 3000;
  return new Promise((resolve) => {
    let u;
    try { u = new URL(baseUrl); } catch { resolve(false); return; }
    if (u.protocol !== 'http:' || !token) { resolve(false); return; }
    const n = newNonce();
    const path = PROOF_PATH + '?n=' + n + '&k=' + keyId(token);
    let done = false, req = null;
    // One deadline for the whole exchange: a socket timeout alone resets on every byte a slow listener sends.
    const deadline = setTimeout(() => { if (req) req.destroy(); finish(false); }, timeoutMs);
    const finish = (v) => { if (!done) { done = true; clearTimeout(deadline); resolve(v); } };
    req = http.get({ hostname: u.hostname, port: portOf(u), path }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (b.length < 4096) b += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) { finish(false); return; }
        let j; try { j = JSON.parse(b); } catch { finish(false); return; }
        finish(proofMatches(token, n, j && j.proof, portOf(u)));
      });
      res.on('error', () => finish(false));
    });
    req.on('error', () => finish(false));
  });
}

module.exports = { PROOF_PATH, keyId, proof, newNonce, proofMatches, answer, boardHoldsToken, portOf };

if (require.main === module) {
  const [flag, base] = process.argv.slice(2);
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    if (flag === '--key') { const t = input.trim(); if (!t) process.exit(1); process.stdout.write(keyId(t)); process.exit(0); }
    if (flag === '--verify' && base) {
      const [t, n, ...rest] = input.split('\n');
      let u, j;
      try { u = new URL(base); j = JSON.parse(rest.join('\n')); } catch { process.exit(1); }
      process.exit(t && proofMatches(t.trim(), String(n).trim(), j && j.proof, portOf(u)) ? 0 : 1);
    }
    process.stderr.write('usage: boardproof.js --key | --verify <base url> (input on stdin)\n');
    process.exit(2);
  });
}
