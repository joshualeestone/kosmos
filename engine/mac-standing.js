'use strict';
/**
 * Federation Kosmos+ gate, W1 refresh: the board-side mac-authenticated READ of the
 * current account standing from the coordinator's /v1/mac/standing route.
 *
 * Mirrors engine/updating.js's mac-cert client (POST /v1/mac/updating): the board
 * holds a mac client certificate (tls.crt / tls.key in the tunnel state dir) and
 * calls the coordinator's /v1/mac/* routes directly in node, mac-signed, NO bearer
 * token (there is no persistent bearer -- the sign-in session token is spent at
 * register). This lives in its own module, not in remote.js, to keep remote.js's
 * "NO CRYPTO HERE" boundary: exactly as updating.js is a separate module for its
 * mac-cert POST.
 *
 * This is the SOURCE that remote.js's refreshStandingIfStale() re-fetches on a TTL,
 * so an UPGRADE (paid after enrolment) takes effect within ~one TTL without a
 * re-sign-in; a LAPSE is caught within a TTL too, but the fed-route 403 stays the
 * HARD gate -- this only keeps the UI honest.
 *
 * Best-effort by contract: fetchStanding() resolves to the current standing STRING,
 * or null when it cannot be determined (not enrolled/switched-off, offline, TLS or
 * auth failure, non-2xx, or an unparseable/oversized body). A null NEVER changes the
 * cache upstream (remote.js keeps the last-known value), so a transient failure
 * cannot flicker a member off.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const ROUTE = '/v1/mac/standing';
/* A read on a busy box; a slow coordinator must not stall the refresh (which is
   itself non-blocking upstream, but bound the socket anyway). */
const TIMEOUT_MS = 4000;
const MAX_BODY = 65536;

/* Test seam, exactly like updating.js: replaces the TRANSPORT ONLY, so enrolment,
   the cert read and the URL derivation all still run under test. */
let requestFactory = null;
function setRequestFactory(f) { requestFactory = typeof f === 'function' ? f : null; }
function defaultRequest(opts) { return (opts.protocol === 'http:' ? http : https).request(opts); }

/* Pull the standing string out of the coordinator's JSON. ICK's confirmed StandingResp
   is { standing: 'good'|'off'|<other>, valid_until, grace_until, receipt } -- kosmos_plus
   is DERIVED (== standing=='good'), there is no bool field. Read `standing`. The
   `{ kosmos_plus:bool }` arm is kept only as a defensive fallback (harmless -- the string
   wins when present; kosmos_plus==standing=='good' is ICK's own identity so it cannot
   disagree); null when neither is present. */
function parseStanding(bodyText) {
  let j;
  try { j = JSON.parse(bodyText); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  if (typeof j.standing === 'string') return j.standing;
  if (typeof j.kosmos_plus === 'boolean') return j.kosmos_plus ? 'good' : 'none';
  return null;
}

/* fetchStanding() -- best effort, never throws. Resolves to the standing string or null. */
async function fetchStanding() {
  // Lazy require: remote.js freezes its data root at module scope, so requiring it at
  // call time (not import time) follows the same ordering discipline updating.js keeps.
  /* 🛑 SUITE GUARD FIRST, before any require() -- aligning with updating.js, which checks
     it ahead of loading ./remote to avoid a module-load/data-root-freeze ordering trap.
     Under node's test runner NEVER dial the real coordinator unless a fake transport is
     injected: NODE_TEST_CONTEXT is set by node --test, and without this any test that
     enrols a sandbox Mac and lets the shipped fetcher run would GET the PAID production
     coordinator (login.kosmosplus.com) with a bogus cert. Keyed on the injected factory so
     a test that supplies its own transport still runs the real path. */
  if (!requestFactory && process.env.NODE_TEST_CONTEXT) return null;
  let remote;
  try { remote = require('./remote'); } catch { return null; }
  try {
    // Gate on the switch AND enrolment, like updating.js: a PAID route must not be
    // called when the feature is off, and there is no mac identity when not enrolled.
    if (!remote.read().on || !remote.enrolled()) return null;
    const dir = remote.stateDir();
    let cert, key;
    try {
      cert = fs.readFileSync(path.join(dir, 'tls.crt'));
      key = fs.readFileSync(path.join(dir, 'tls.key'));
    } catch { return null; }
    const base = new URL(remote.coordinator());
    // Keep a self-hosted coordinator's path prefix: https://h/kosmos -> /kosmos/v1/mac/standing.
    const prefix = base.pathname.replace(/\/+$/, '');
    /* POST with an empty JSON body, exactly like updating.js's /v1/mac/updating: the
       coordinator's verify_mac_request requires POST, and the "mac signature" is the
       mTLS CLIENT CERT (tls.crt/tls.key) presented in the TLS handshake -- updating.js
       authenticates the same family of routes with cert+key and no explicit signature
       header, so /v1/mac/standing does too. The body carries nothing; the standing is
       identified by the mac cert alone. */
    const body = '{}';
    const opts = {
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || undefined,
      path: prefix + ROUTE,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      cert,
      key,
      timeout: TIMEOUT_MS,
      agent: false,
      /* NO `ca` option, deliberately -- system trust store, exactly like updating.js
         (setting `ca` REPLACES the store and would break the public coordinator for a
         self-hoster who set it for their relay). TLS verification is never disabled. */
    };
    // module.exports.dispatch (not the bare defaultRequest) so a test can spy on the
    // DEFAULT transport and prove the suite guard actually prevents a real dial.
    const make = requestFactory || module.exports.dispatch;
    return await new Promise((resolve) => {
      let settled = false;
      let hardStop;
      const done = (v) => { if (!settled) { settled = true; if (hardStop) clearTimeout(hardStop); resolve(v); } };
      /* An overall backstop so this ALWAYS settles and the caller's single-flight flag
         always clears -- even against a pathological socket that stays active (resetting
         the inactivity `timeout`) yet never ends. The socket timeout bounds inactivity;
         this bounds the rest. unref so it never keeps the process alive. */
      hardStop = setTimeout(() => done(null), TIMEOUT_MS + 1000);
      if (typeof hardStop.unref === 'function') hardStop.unref();
      let req;
      try { req = make(opts); } catch { return done(null); }
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
          res.on('end', () => done(parseStanding(buf)));
          res.on('error', () => done(null));
        } catch { done(null); }
      });
      try { req.end(body); } catch { return done(null); }
    });
  } catch { return null; }
}

module.exports = { ROUTE, TIMEOUT_MS, fetchStanding, parseStanding, setRequestFactory, dispatch: defaultRequest };
