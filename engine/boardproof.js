'use strict';
/* #1765: the board proves it is THIS account's board before any client sends it a token.

   Every client finds the board by a loopback port. Another account on the same machine can listen on that
   port whenever the board is not (at login before the board starts, during an update restart, after a crash),
   and a client that sends its token to whatever answers hands the token to that listener. So a client asks
   first: it sends a fresh random nonce and a short key id for the token it holds, and only a listener that
   already holds that same token can answer with HMAC-SHA256(token, nonce). The client checks the answer
   with its own copy and sends the token only when it matches.

   The key id is a hash prefix, so the request carries nothing a listener can use to authenticate. A real
   board answers for any nonce, but a fresh 128-bit client nonce makes a stored answer useless, and a
   listener on the board's port cannot relay to the real board, which cannot hold that port at the same time.

   Shared by the board (answer) and every node client (check). The CLI calls it as a program:
     printf '%s' "$token" | node boardproof.js --check <base url>   (exit 0 = proven, 1 = not, 2 = usage)
   The token comes on stdin, never argv, which `ps` shows to every account. */
const crypto = require('crypto');
const http = require('http');

const PROOF_PATH = '/api/board-proof';
const NONCE_RE = /^[0-9a-f]{32}$/;
const KEY_ID_RE = /^[0-9a-f]{16}$/;

function keyId(token) {
  return crypto.createHash('sha256').update('kosmos-board-proof-key\0' + String(token)).digest('hex').slice(0, 16);
}
function proof(token, nonce) {
  return crypto.createHmac('sha256', String(token)).update('kosmos-board-proof\0' + String(nonce)).digest('hex');
}
function newNonce() { return crypto.randomBytes(16).toString('hex'); }
function proofMatches(token, nonce, answer) {
  if (typeof answer !== 'string' || !/^[0-9a-f]{64}$/.test(answer)) return false;
  const want = Buffer.from(proof(token, nonce), 'hex');
  const got = Buffer.from(answer, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* The board's side. `candidates` is a function returning the tokens this board holds (its world tokens, then
   its agents' tokens), called only for a well-formed request. Returns { status, body }. */
function answer(query, candidates) {
  const n = query && query.n, k = query && query.k;
  if (typeof n !== 'string' || !NONCE_RE.test(n) || typeof k !== 'string' || !KEY_ID_RE.test(k)) {
    return { status: 400, body: { error: 'a board proof needs n (32 hex) and k (16 hex)' } };
  }
  let list = [];
  try { list = candidates() || []; } catch { list = []; }
  for (const t of list) {
    if (typeof t === 'string' && t && keyId(t) === k) return { status: 200, body: { proof: proof(t, n) } };
  }
  return { status: 404, body: { error: 'this board holds no token with that key id' } };
}

/* The client's side: does the listener at baseUrl hold `token`? Resolves true or false, never throws.
   Loopback http only; anything else is false, because no client of this module talks to anything else. */
function boardHoldsToken(baseUrl, token, opts = {}) {
  const timeoutMs = opts.timeoutMs || 3000;
  return new Promise((resolve) => {
    let u;
    try { u = new URL(baseUrl); } catch { resolve(false); return; }
    if (u.protocol !== 'http:' || !token) { resolve(false); return; }
    const n = newNonce();
    const path = PROOF_PATH + '?n=' + n + '&k=' + keyId(token);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get({ hostname: u.hostname, port: u.port || 80, path, timeout: timeoutMs }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (b.length < 4096) b += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) { finish(false); return; }
        let j; try { j = JSON.parse(b); } catch { finish(false); return; }
        finish(proofMatches(token, n, j && j.proof));
      });
      res.on('error', () => finish(false));
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  });
}

module.exports = { PROOF_PATH, keyId, proof, newNonce, proofMatches, answer, boardHoldsToken };

if (require.main === module) {
  const [flag, base] = process.argv.slice(2);
  if (flag !== '--check' || !base) { process.stderr.write('usage: boardproof.js --check <base url> (token on stdin)\n'); process.exit(2); }
  let tok = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { tok += d; });
  process.stdin.on('end', () => {
    boardHoldsToken(base, tok.trim()).then((ok) => process.exit(ok ? 0 : 1));
  });
}
