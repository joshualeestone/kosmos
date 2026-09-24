'use strict';
/**
 * #718 (#3510): the coordinator's VAPID public key, for the board's same-origin
 * GET /v1/push/vapid-key. The push client (web/index.html, #3520) asks the board
 * for the applicationServerKey before PushManager.subscribe; the coordinator
 * (kosmos-relay coordinator/src/push.rs, PATH_VAPID_KEY) owns the key pair, so
 * the board fetches the PUBLIC half and never holds a key of its own. The static
 * key the branch once carried is gone: a key the coordinator did not mint signs
 * nothing the push service will accept.
 *
 * Unauthenticated by design: the coordinator serves this route with no auth
 * because it is a public key (docs/attack-surface.md in kosmos-relay). So no
 * mac cert, no bearer, and no enrolment gate here.
 *
 * Cached on success only. The key changes only when the coordinator rotates its
 * pair, so a cached key is right for CACHE_MS; a failure is never cached, so a
 * coordinator that was briefly down is asked again on the next Turn on.
 *
 * Best effort, never throws: fetchVapidKey() resolves to the key string or null.
 * The route turns null into a plain-words 502; the client already keeps the
 * button retryable on any failure.
 */

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const ROUTE = '/v1/push/vapid-key';
const TIMEOUT_MS = 4000;
const MAX_BODY = 4096;
const CACHE_MS = 60 * 60 * 1000;
/* An uncompressed P-256 point is 65 bytes, 87 base64url characters unpadded.
   Anything else is not a key PushManager.subscribe can use, so it is refused
   here rather than handed to the browser to fail on. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{87}$/;

function defaultRequest(opts) { return (opts.protocol === 'http:' ? http : https).request(opts); }

// Test seam: a fake transport. Without one, the suite guard below refuses to dial.
let requestFactory = null;
function setRequestFactory(fn) { requestFactory = typeof fn === 'function' ? fn : null; }

let cached = null;   // { key, at }
function clearCache() { cached = null; }

function parseKey(buf) {
  try {
    const j = JSON.parse(buf);
    return j && typeof j.key === 'string' && KEY_SHAPE.test(j.key) ? j.key : null;
  } catch { return null; }
}

async function fetchVapidKey(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.key;
  /* 🛑 SUITE GUARD, as in mac-standing.js: under node --test never dial the real
     coordinator (login.kosmosplus.com) unless a test injected a transport. */
  if (!requestFactory && process.env.NODE_TEST_CONTEXT) return null;
  let base;
  try { base = new URL(require('./remote').coordinator()); } catch { return null; }
  // Keep a self-hosted coordinator's path prefix: https://h/kosmos -> /kosmos/v1/push/vapid-key.
  const prefix = base.pathname.replace(/\/+$/, '');
  const reqOpts = {
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port || undefined,
    path: prefix + ROUTE,
    method: 'GET',
    headers: { accept: 'application/json' },
    timeout: TIMEOUT_MS,
    agent: false,
    // NO `ca` option: system trust store, as mac-standing.js and updating.js.
  };
  const make = requestFactory || module.exports.dispatch;
  const key = await new Promise((resolve) => {
    let settled = false;
    let hardStop;
    const done = (v) => { if (!settled) { settled = true; if (hardStop) clearTimeout(hardStop); resolve(v); } };
    // Overall backstop: the socket timeout bounds inactivity, this bounds the rest.
    hardStop = setTimeout(() => done(null), TIMEOUT_MS + 1000);
    if (typeof hardStop.unref === 'function') hardStop.unref();
    let req;
    try { req = make(reqOpts); } catch { return done(null); }
    if (!req || typeof req.on !== 'function') return done(null);
    req.on('error', () => done(null));
    req.on('timeout', () => { try { req.destroy(); } catch { /* already gone */ } done(null); });
    req.on('response', (res) => {
      try {
        const code = res.statusCode;
        if (typeof code !== 'number' || code < 200 || code >= 300) { res.resume(); return done(null); }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          buf += c;
          if (buf.length > MAX_BODY) { try { req.destroy(); } catch { /* gone */ } done(null); }
        });
        res.on('end', () => done(parseKey(buf)));
        res.on('error', () => done(null));
      } catch { done(null); }
    });
    try { req.end(); } catch { return done(null); }
  });
  if (key) cached = { key, at: now };
  return key;
}

module.exports = { ROUTE, CACHE_MS, KEY_SHAPE, fetchVapidKey, parseKey, setRequestFactory, clearCache, dispatch: defaultRequest };
