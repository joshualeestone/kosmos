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
   bound to the address and port: the client puts in the message the ones it dialled (always 127.0.0.1) and the
   board the ones the connection reached, so a listener cannot pass on an answer from a board on another port, or
   from the same board reached at another address (::1 when it was started to listen on every address).

   Shared by the board (answer) and the node check (boardHoldsToken, for node clients such as the report
   bridges). The CLI fetches the proof with its own curl (through the same #4933 route logic as its request,
   within half its time limit) and runs this file only for the arithmetic:
     printf '%s' "$token" | node boardproof.js --key                       prints the key id
     printf '%s\n%s\n%s' "$token" "$nonce" "$answer" | node boardproof.js --verify <base url>
       exit 0 proven, 3 not proven, 4 a bad base url, 2 usage (the CLI reads anything but 0 and 3 as its own fault);
       --key exits 1 on an empty token
   The token comes on stdin, never argv, which `ps` shows to every account. */
const crypto = require('crypto');
const http = require('http');

const PROOF_PATH = '/api/board-proof';
// The client's fresh nonce, in bytes (sent as twice as many hex characters), and the key id's length in hex
// characters. install/kosmos makes its nonce with the same count (KOSMOS_PROOF_NONCE_BYTES, pinned by a test).
const NONCE_BYTES = 16;
const KEY_ID_HEX = 16;
// Domain tags, so a key id and a proof can never be mistaken for each other or for any other HMAC over the token.
const KEY_ID_TAG = 'kosmos-board-proof-key\0';
const PROOF_TAG = 'kosmos-board-proof\0';
// An HMAC-SHA256 proof as hex: 32 bytes, 64 characters.
const PROOF_HEX = 64;
// The address every client dials, and so the one a client always names in the proof.
const CLIENT_ADDR = '127.0.0.1';
// The longest proof answer a client reads: a real one is a few dozen bytes, so anything longer is a listener stalling
// the client. install/kosmos passes the same number to curl as --max-filesize (KOSMOS_PROOF_MAX_BYTES there).
const PROOF_ANSWER_MAX_BYTES = 4096;
// A node client's default limit for the whole proof exchange, when its caller gives none.
// 3 s: the report bridges' own keep bound, so a proof never holds an edit longer than the send it guards would.
const PROOF_DEFAULT_TIMEOUT_MS = 3000;
const NONCE_RE = new RegExp('^[0-9a-f]{' + NONCE_BYTES * 2 + '}$');
const KEY_ID_RE = new RegExp('^[0-9a-f]{' + KEY_ID_HEX + '}$');
const PROOF_RE = new RegExp('^[0-9a-f]{' + PROOF_HEX + '}$');

function keyId(token) {
  return crypto.createHash('sha256').update(KEY_ID_TAG + String(token)).digest('hex').slice(0, KEY_ID_HEX);
}
/* `addr` is required: the address the binding pins. A missing one would sign for a default, which is the case the
   binding exists to rule out, so it throws instead. */
function proof(token, nonce, port, addr) {
  if (!addr) throw new Error('board-proof: proof() needs the address');
  return crypto.createHmac('sha256', String(token))
    .update(PROOF_TAG + String(addr) + '\0' + String(port) + '\0' + String(nonce)).digest('hex');
}
/* The address a board connection reached, as a client names it: an IPv4-mapped one (::ffff:127.0.0.1, on a board
   listening on every address) is the plain IPv4 address the client dialled. */
const IPV4_MAPPED_PREFIX = '::ffff:';
function plainAddr(a) { const s = String(a || ''); return s.startsWith(IPV4_MAPPED_PREFIX) ? s.slice(IPV4_MAPPED_PREFIX.length) : s; }
function newNonce() { return crypto.randomBytes(NONCE_BYTES).toString('hex'); }
function proofMatches(token, nonce, answer, port, addr) {
  if (typeof answer !== 'string' || !PROOF_RE.test(answer) || !addr) return false;
  const want = Buffer.from(proof(token, nonce, port, addr), 'hex');
  const got = Buffer.from(answer, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// The proof route needs no token, so anyone local can repeat a failing request: each distinct failure message is
// logged once, from a remembered set that starts again past LOG_KEEP (the messages carry error text). server.js
// logs the route's own failures through this same helper.
const LOG_KEEP = 50;
const logged = new Set();
function logOnce(msg) {
  if (logged.has(msg)) return;
  if (logged.size >= LOG_KEEP) logged.clear();
  logged.add(msg); console.error('board-proof: ' + msg);
}
/* The board's side. `candidates(k)` returns an iterable of the tokens this board holds, cheapest lookups first (a
   generator, so it stops at the first match; it is given the key id, which selects at most one token).
   Called only for a well-formed request.
   `port` and `addr` are the local port and address the asking connection reached (req.socket.localPort and
   localAddress). Returns { status, body }. */
function answer(query, candidates, port, addr) {
  if (!addr) return { status: 500, body: { error: 'the board could not tell which address this request reached' } };
  const n = query && query.n, k = query && query.k;
  if (typeof n !== 'string' || !NONCE_RE.test(n) || typeof k !== 'string' || !KEY_ID_RE.test(k)) {
    return { status: 400, body: { error: 'a board proof needs n (' + NONCE_BYTES * 2 + ' hex) and k (' + KEY_ID_HEX + ' hex)' } };
  }
  try {
    for (const token of candidates(k) || []) {
      if (typeof token === 'string' && token && keyId(token) === k) return { status: 200, body: { proof: proof(token, n, port, plainAddr(addr)) } };
    }
  } catch (e) {
    // An unreadable token store proves nothing, but say so: the client reads the 404 as "not your board".
    const msg = 'could not read the tokens to answer a proof: ' + ((e && e.message) || e);
    logOnce(msg);
  }
  return { status: 404, body: { error: 'this board holds no token with that key id' } };
}

/* The client's side: does the listener at baseUrl hold `token`? Resolves true or false, never throws.
   http://127.0.0.1 only (see loopbackHttp); anything else is false, since the board is only ever there. */
const HTTP_DEFAULT_PORT = '80';   // what URL leaves out of .port for http
function portOf(u) { return u.port || HTTP_DEFAULT_PORT; }
// 127.0.0.1 only, where the board listens. Not `localhost`: it can resolve to ::1, and the proof binds the address
// the client names, which is always 127.0.0.1, so a ::1 dial could never be proved anyway.
function loopbackHttp(u) { return u.protocol === 'http:' && u.hostname === '127.0.0.1'; }

function boardHoldsToken(baseUrl, token, opts) {
  opts = opts || {};
  // A missing, zero, negative or non-numeric limit takes the default rather than timing out at once.
  const timeoutMs = (Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) ? opts.timeoutMs : PROOF_DEFAULT_TIMEOUT_MS;
  // opts.onRefuse(why) hears why a check came out false (a squatter's answer, a timeout, a refusal to connect), so a
  // sender can record it where its own output allows; the result is false either way.
  const no = (why) => { if (typeof opts.onRefuse === 'function') { try { opts.onRefuse(why); } catch { /* the caller's */ } } return false; };
  if (typeof opts.fetchImpl === 'function') return holdsViaFetch(baseUrl, token, opts.fetchImpl, timeoutMs, no);
  return new Promise((resolve) => {
    let u;
    try { u = new URL(baseUrl); } catch { resolve(no('not a URL')); return; }
    if (!loopbackHttp(u)) { resolve(no('not http://127.0.0.1')); return; }
    if (!token) { resolve(no('no token')); return; }
    const n = newNonce();
    const path = PROOF_PATH + '?n=' + n + '&k=' + keyId(token);
    let done = false, req = null;
    const finish = (v, why) => { if (!done) { done = true; clearTimeout(deadline); resolve(v ? true : no(why)); } };
    // One deadline for the whole exchange: a socket timeout alone resets on every byte a slow listener sends.
    const deadline = setTimeout(() => { if (req) req.destroy(); finish(false, 'timed out'); }, timeoutMs);
    req = http.get({ hostname: u.hostname, port: portOf(u), path }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; if (Buffer.byteLength(b) > PROOF_ANSWER_MAX_BYTES) { req.destroy(); finish(false, 'answer over the cap'); } });
      res.on('end', () => {
        if (res.statusCode !== 200) { finish(false, 'answered ' + res.statusCode); return; }
        let j; try { j = JSON.parse(b); } catch { finish(false, 'answer not JSON'); return; }
        const ok = proofMatches(token, n, j && j.proof, portOf(u), CLIENT_ADDR);
        finish(ok, 'answer is not a proof');
      });
      res.on('error', (e) => finish(false, 'read failed: ' + ((e && e.code) || e)));
    });
    req.on('error', (e) => finish(false, 'request failed: ' + ((e && e.code) || e)));   // a refused connect or a reset
  });
}

/* The same check through a fetch-shaped function, for node senders that send with fetch (the report bridges; a
   test passes its own), so the proof goes the way their request goes. One deadline covers the request and body,
   through `signal`: a fetch that ignores its signal is not bounded by it. Redirects are refused, so a listener
   cannot send the proof request somewhere else, and the answer is read in chunks and abandoned past
   PROOF_ANSWER_MAX_BYTES. A response with no readable stream (a test stub's, or a fetch such as node-fetch v2) is
   read whole and then checked, bounded only by the deadline, and only if that fetch honours its signal. */
async function readCapped(res, cap) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > cap) { try { await reader.cancel(); } catch { /* gone */ } return null; }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof res.text !== 'function') return null;
  const t = String(await res.text());
  return Buffer.byteLength(t) > cap ? null : t;   // bytes, as on the stream and http paths
}
async function holdsViaFetch(baseUrl, token, doFetch, timeoutMs, no) {
  let u;   // the same order as the http path: the URL, then the token
  try { u = new URL(baseUrl); } catch { return no('not a URL'); }
  if (!loopbackHttp(u)) return no('not http://127.0.0.1');
  if (!token) return no('no token');
  const n = newNonce();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(u.origin + PROOF_PATH + '?n=' + n + '&k=' + keyId(token), { signal: controller.signal, redirect: 'error' });
    if (!res || res.status !== 200) {
      try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch { /* gone */ }
      return no('answered ' + (res ? res.status : 'nothing'));
    }
    const text = await readCapped(res, PROOF_ANSWER_MAX_BYTES);
    if (text === null) return no('answer over the cap');
    let j;
    try { j = JSON.parse(text); } catch { return no('answer not JSON'); }   // never the parser's text, which can quote the listener's bytes
    return proofMatches(token, n, j && j.proof, portOf(u), CLIENT_ADDR) || no('answer is not a proof');
  } catch (e) { return no((e && e.name === 'AbortError') ? 'timed out' : 'failed: ' + ((e && e.message) || e)); } finally { clearTimeout(timer); }
}

// The agent-token header. The repo spells it out at each site (server.js, the report hook); there is no shared
// constant to take it from yet.
const AGENT_HEADER = 'x-kosmos-agent-token';

/* The token a sender's headers carry, '' when they carry none, or null when they cannot be read. In the board's own
   order (boardauth.presentedToken): the board cookie (read by boardauth.cookieToken itself, so the two cannot
   differ), then the board-token header, then the agent-token header. When a request carries both a board token and
   an agent token, only the first is proved: a listener holding this account's board token is this board. Headers
   are read through `new Headers`, which takes every shape fetch does (a plain object, an array of pairs, a Headers,
   a Map) and matches names in any case: a shape or spelling missed here would send a token unproven. Headers only:
   a sender keeps its tokens in headers. */
function tokenIn(headers) {
  try {
    const h = new Headers(headers || {});
    const boardauth = require('./boardauth');   // the board's own names and cookie reader, so the two cannot differ
    const raw = h.get('cookie') || '';
    const cookie = raw ? boardauth.cookieToken({ headers: { cookie: raw } }) : null;
    // A cookie part whose name is the board cookie's in any case (spaces around it trimmed, as the board trims them),
    // which the board did not read as a token (empty first, or another case), is unreadable, not tokenless: refused
    // rather than sent unproven.
    // Split on commas too (a header folded from two), and also refuse when the name appears with its = anywhere in
    // the raw text: over-broad on purpose, since refusing is the safe direction.
    const name = boardauth.COOKIE_NAME.toLowerCase();
    const named = raw.toLowerCase().includes(name + '=') || raw.split(/[;,]/).some((part) => {
      const eq = part.indexOf('=');
      return eq >= 0 && part.slice(0, eq).trim().toLowerCase() === name;
    });
    if (!cookie && named) return null;
    return cookie || h.get(boardauth.HEADER_NAME) || h.get(AGENT_HEADER) || '';
  } catch { return null; }
}

/* A node sender's gate, called before every token-bearing send: true when `headers` carry no token (nothing to
   protect) or the listener at baseUrl proved it holds the token they carry; false means send nothing. */
async function mayCarryTokensTo(baseUrl, headers, opts) {
  opts = opts || {};
  const t = tokenIn(headers);
  if (t === null) { if (typeof opts.onRefuse === 'function') { try { opts.onRefuse('headers unreadable'); } catch { /* the caller's */ } } return false; }   // refuse rather than guess there is no token
  if (!t) return true;
  return boardHoldsToken(baseUrl, t, opts);
}

module.exports = { PROOF_PATH, AGENT_HEADER, logOnce, PROOF_ANSWER_MAX_BYTES, NONCE_BYTES, KEY_ID_HEX, PROOF_HEX, CLIENT_ADDR, keyId, proof, newNonce, proofMatches, answer, boardHoldsToken, portOf, mayCarryTokensTo, tokenIn };

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
      try { u = new URL(base); } catch { process.exit(4); }   // our own bad input, not the listener's
      if (!loopbackHttp(u)) process.exit(4);   // http://127.0.0.1 only, as on every other client path
      try { j = JSON.parse(rest.join('\n')); } catch { process.exit(3); }   // an answer that is not JSON proves nothing
      process.exit(t && proofMatches(t.trim(), String(n).trim(), j && j.proof, portOf(u), CLIENT_ADDR) ? 0 : 3);
    }
    process.stderr.write('usage: boardproof.js --key | --verify <base url> (input on stdin)\n');
    process.exit(2);
  });
}
