'use strict';
/* kosmos#988: tell the coordinator while an update is applying, so a person on
 * their phone is told "your Mac is updating Kosmos, back in a moment" instead of
 * "Kosmos is not answering on this computer".
 *
 * Josh saw the second message from his phone one minute after 0.5.68 served. His
 * Mac had taken the update and restarted the board. The relay was up; only the
 * board behind it was down for the restart. A person cannot tell that apart from
 * a broken Mac, and the honest reading of what they can see is "it broke".
 *
 * THE CONTRACT, from the coordinator route's author (Ice Cream Kitty, #988):
 *   POST /v1/mac/updating {"seconds": N}  when it begins applying
 *   POST /v1/mac/updating {"seconds": 0}  when it finishes
 * Authenticated with the mac's client certificate, like the other /v1/mac/*
 * routes. The deadline is capped at 15 minutes server-side, so asking for more
 * is safe and simply gets the cap.
 *
 * 🛑 WHY THIS SPEAKS HTTP DIRECTLY INSTEAD OF GOING THROUGH kosmos-tunnel.
 * remote.js does not speak HTTP to the coordinator; it spawns the tunnel binary
 * with subcommands. Adding an `updating` subcommand looks smaller and is
 * strictly slower: the tunnel source is not in this repo at all, and the binary
 * is bundled, so a new subcommand reaches no Mac until a release cut. The mac
 * already holds the client certificate this route needs, and node can present it.
 *
 * 🛑 NOTHING HERE MAY FAIL AN UPDATE. The caller is the one route that installs
 * software. engine/notify.js is the precedent: an outer try/catch that swallows
 * everything, a short timeout, fire and forget, no retry.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const ROUTE = '/v1/mac/updating';
/* Short on purpose. This runs microseconds after the installer is spawned, on a
 * box about to be busy; a slow coordinator must not hold the update. */
const TIMEOUT_MS = 3000;
/* Ask for more than any install should need. The server caps at 15 minutes, so
 * this is a request for the cap rather than a promise about duration. */
const DEFAULT_SECONDS = 900;

/* Test seam. It replaces THE TRANSPORT AND NOTHING ELSE: enrolment, the
 * certificate read, and the URL derivation all still run, so an arm can catch a
 * wrong path, a missing cert or a broken coordinator derivation. An earlier
 * version replaced the whole send, which made every one of those invisible. */
let requestFactory = null;

/* 🛑 THE GUARD THAT KEEPS THE SUITE OFF THE REAL COORDINATOR (kosmos#988).
 * engine/ping.js's underTest(), which engine/notify.js consults for exactly this
 * reason. Without it, running the test suite on an ENROLLED Mac posts real
 * `{"seconds":900}` with the operator's client certificate, and one existing
 * suite (update.marker-1728) drives a child stub that never exits, so nothing
 * ever clears it: the operator's phone then reads "your Mac is updating Kosmos,
 * back in a moment" for the full 15-minute cap while nothing is updating. That
 * is this card's own message, inverted, by its own test suite.
 * Keyed on an INJECTED FACTORY, not on the environment: a test that supplies its
 * own transport touches no network, so the guard must not disable it. */
function underTest() {
  /* ONE derivation, from the module this file's header already cites and that
     notify.js calls directly. An earlier version re-implemented the
     NODE_TEST_CONTEXT check here, which is the second-derivation problem the
     #790 comment in remote.js describes: two copies disagree the moment one of
     them learns something. Lazy require for the same data-root reason as below. */
  try { return Boolean(require('./ping').underTest()); }
  catch { return Boolean(process.env.NODE_TEST_CONTEXT); }
}

/* Only a real number is honoured. `Number(null)`, `Number('')`, `Number(false)`
 * and `Number([])` are all 0, so coercing would turn a caller's typo into the
 * FINISH signal and clear a banner that should be showing. Anything that is not
 * a finite number asks for the default instead, which is the safe direction. */
function seconds(v) {
  /* `typeof undefined !== 'number'`, so this one line covers undefined too. */
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SECONDS;
  /* A NEGATIVE is finite, so an earlier version clamped it to 0, which is the
     FINISH signal: the exact direction the rule above exists to avoid. A caller
     typo of -1 would have cleared a live banner. Only 0 itself means finished. */
  if (v < 0) return DEFAULT_SECONDS;
  return Math.trunc(v);
}

/* announce(n) -- best effort. Returns nothing, throws nothing, blocks nothing.
 * n === 0 means "finished". */
function announce(v) {
  try {
    const n = seconds(v);
    /* 🛑 THE GUARD RUNS BEFORE ANY require(), AND THAT ORDER IS THE POINT.
       An earlier version required ./remote first and only then checked. Measured:
       that made a NODE_TEST_CONTEXT process which merely calls startPolling()
       load remote, ping AND store, none of which origin/main's update path
       touches. Both remote.js and ping.js bind `const BASE = store.ROOT` at
       module scope, so the first announce() froze the data root for both, and it
       newly reached store.root() and its legacy-store migration from the update
       path. The lazy require moved the freeze from import time to first-announce
       time; it did not remove it. Checking first does.
       The predicate is inlined rather than calling ping.underTest(), which is a
       deliberate reversal: consulting ping would load the very module this order
       exists to avoid. It is one boolean against an env var, ping.js:171 is its
       single line, and underTest() below still delegates so nothing else copies
       it. Keyed on an INJECTED FACTORY, not the environment, so a test that
       supplies its own transport is not disabled. */
    if (!requestFactory && process.env.NODE_TEST_CONTEXT) return;
    /* Still lazy: update.js is required early, and remote.js freezes its root at
       module scope. update.js:275 requires ./autoupdate late for the same reason. */
    const remote = require('./remote');
    if (!remote.enrolled()) return;   // nothing to say, and nothing to say it with

    const dir = remote.stateDir();
    let cert;
    let key;
    try {
      cert = fs.readFileSync(path.join(dir, 'tls.crt'));
      key = fs.readFileSync(path.join(dir, 'tls.key'));
      /* Locality, not behaviour. enrolled() said these exist; if one vanished in
         the window since, this returns quietly. Removing this catch changes
         NOTHING observable, because the outer guard swallows the same throw and
         no request gets built either way (measured by perturbation). It is kept
         because the local return says what happens here, and it is documented as
         indistinguishable so nobody writes an arm claiming to discriminate it. */
    } catch { return; }

    const base = new URL(remote.coordinator());
    /* Keep any path prefix a self-hosted coordinator carries: `https://h/kosmos`
       must become `/kosmos/v1/mac/updating`, not `/v1/mac/updating`. */
    const prefix = base.pathname.replace(/\/+$/, '');
    const body = JSON.stringify({ seconds: n });
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
      /* Not a claim about whether the global agent would work: an earlier version
         of this comment asserted that it "silently ignores per-request cert/key",
         which is not something I measured and which Agent#getName appears to
         contradict. What IS true and is the reason: a fresh connection per call
         needs no assumption about how the socket pool is keyed, and it avoids
         parking a keep-alive socket keyed on the identity certificate for a call
         that happens roughly twice per update. */
      agent: false,
    };
    /* 🛑 NO `ca` OPTION, DELIBERATELY. An earlier version honoured
       AGENT_WORKFORCE_TUNNEL_CA here and claimed it was "the same way remote.js
       honours it for the tunnel". That is false: remote.js documents that var as
       "extra CA for a dev/self-host RELAY ONLY" and passes it as --tunnel-ca.
       It is not the coordinator's CA. Worse, setting `ca` REPLACES the default
       trust store, so a self-hoster who set it for their relay while still
       talking to the public coordinator would fail verification on every
       announce, silently, because this fails open. There is no documented
       coordinator CA var; until there is, the system store is the right answer.
       TLS verification is never disabled either way. */

    const make = requestFactory || defaultRequest;
    const req = make(opts, body);
    if (!req || typeof req.on !== 'function') return;
    /* Every one of these is a path an update must survive. */
    req.on('error', () => { /* unreachable coordinator, TLS refusal, DNS, bad protocol */ });
    req.on('timeout', () => { try { req.destroy(); } catch { /* already gone */ } });
    req.on('response', (res) => {
      try {
        const code = res.statusCode;
        /* One line, on the log launchd keeps, for the case nobody could
           otherwise see: this route is merged but not yet deployed, so the first
           real deployment has no other client-side way to be checked.
           remote.js:243 sets the same precedent. Still fail-open: a bad status
           changes nothing the caller does. */
        if (!(code >= 200 && code < 300)) {
          process.stderr.write('kosmos#988: coordinator answered ' + String(code) + ' for ' + ROUTE + '\n');
        }
        res.resume();
      } catch { /* draining must not throw either */ }
    });
    if (typeof req.end === 'function') req.end(body);
  } catch { /* nothing here may reach the caller */ }
}

function defaultRequest(opts) {
  return (opts.protocol === 'http:' ? http : https).request(opts);
}

/* Replaces the transport only. Pass null to restore the real one. */
function setRequestFactory(f) { requestFactory = typeof f === 'function' ? f : null; }

module.exports = {
  ROUTE,
  TIMEOUT_MS,
  DEFAULT_SECONDS,
  announce,
  seconds,
  underTest,
  /* the real protocol dispatch, exported so it can be covered: rewriting it to
     always use https left the suite green, and https.request on an http: URL
     throws into the outer catch, i.e. silently dead */
  dispatch: defaultRequest,
  /* test seam: replaces the TRANSPORT only, so enrolment, the certificate read
     and the URL derivation all still run under test */
  setRequestFactory,
};
