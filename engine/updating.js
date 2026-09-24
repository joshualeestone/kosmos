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
 * The deadline is capped at 15 minutes server-side, so asking for more is safe
 * and simply gets the cap.
 *
 * 🛑 SIGNED THROUGH THE TUNNEL, NOT SENT FROM NODE (#3626).
 * This module used to POST the route itself over HTTPS with the Mac's TLS client
 * certificate, on the belief that the certificate authenticated it. It does not:
 * the coordinator's verify_mac_request (kosmos-relay coordinator/src/auth.rs)
 * reads only the x-kosmos-mac-id / x-kosmos-ts / x-kosmos-sig headers and has no
 * client-certificate code, so the call could only ever answer 401 "missing
 * signature headers" (measured on the sibling /v1/mac/standing route,
 * kosmos#3626). The phone never heard "updating". The request now goes through
 * remote.macRequest(), the tunnel binary's `mac-request` verb (kosmos-relay
 * #103), which holds the Mac key and signs. The board does no crypto.
 *
 * 🛑 NOTHING HERE MAY FAIL AN UPDATE. The caller is the one route that installs
 * software. The fire-and-forget senders (engine/feedbacksend.js) are the
 * precedent: an outer try/catch that swallows everything, nothing awaited, no
 * retry. The tunnel child is bounded by macRequest's own timeout, and announce()
 * returns before it even starts, so a slow coordinator cannot hold the update.
 */
const ROUTE = '/v1/mac/updating';
/* 🛑 EXACTLY THE SERVER'S CAP, WITH NO HEADROOM AND NO RENEWAL, AND AN EARLIER
 * VERSION OF THIS COMMENT SAID "more than any install should need", WHICH IS NOT
 * TRUE OF A VALUE EQUAL TO THE CAP. The server caps at 15 minutes; this asks for
 * all of it and nothing renews. An install that runs past fifteen minutes drops
 * the banner mid-apply and the phone reverts to the same "not answering" this
 * card exists to remove. A couple-hundred-MB bundle over a slow link reaches
 * that, so it is a real limit rather than a theoretical one. Left as is because a
 * renewal timer adds a second moving part to the install path, and the failure
 * direction is today's behaviour; recorded as a weakest premise in the plan. */
const DEFAULT_SECONDS = 900;

/* Log a failure ONCE instead of swallowing it (#3626): the first failure is
 * written to stderr (the log launchd keeps for the board), the same reason again
 * is not, and a success clears the latch. A silent failure is how the unsigned
 * call went unnoticed. */
let lastLogged = null;
function logFailure(because) {
  let reason = String(because || 'unknown failure');
  /* A board newer than its bundled tunnel (no `mac-request` verb yet) says this;
     name the cause, the way engine/phonenotify.js does for the same message. */
  if (/unrecognized subcommand/.test(reason)) reason += ' (the tunnel on this computer is too old to sign this; it arrives with the next Kosmos update)';
  if (reason === lastLogged) return;
  lastLogged = reason;
  try { process.stderr.write('kosmos#3626: ' + ROUTE + ' failed: ' + reason + '\n'); } catch { /* logging must not throw */ }
}

/* ⚠️ THIS IS NOT THE PRODUCTION GUARD. It is a test-only export, so its own arms
 * can assert the predicate. The live guard is INLINED at the top of announce(),
 * deliberately, because calling this would require ./ping and reintroduce the
 * module-load ordering problem announce() exists to avoid. Confirmed by mutation:
 * replacing this body with `return false` changes exactly one assertion, the one
 * that reads this function's own return value, and nothing else.
 * An earlier version of this comment described it as "the guard that keeps the
 * suite off the real coordinator", which a maintainer would reasonably read as a
 * description of the live path. It is not one. See announce() for that. */
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
  const n = Math.trunc(v);
  /* And the SAME inversion from the other side, which the sentence above claimed
     was already covered and was not: Math.trunc maps every 0 < v < 1 to 0, so
     announce(0.5) asked for half a second and got the FINISH signal. Measured
     before the fix: seconds(0.5), seconds(0.9) and seconds(0.0001) all returned
     0. A sub-second request is not a finish; floor it at one second, which is the
     nearest honest answer and keeps "only 0 itself means finished" true. */
  if (v > 0 && n === 0) return 1;
  return n;
}

/* announce(n) -- best effort. Returns nothing, throws nothing, blocks nothing.
 * n === 0 means "finished". */
function announce(v) {
  try {
    const n = seconds(v);
    /* 🛑 THE GUARD THAT KEEPS THE SUITE OFF THE REAL COORDINATOR (kosmos#988),
       AND IT RUNS BEFORE ANY require(), WHICH IS HALF THE POINT.

       WITHOUT THE GUARD: running the suite on an ENROLLED Mac sends a real
       `{"seconds":900}` signed with the operator's Mac key (and since #3626 that
       request is ACCEPTED, where the old unsigned one was refused), and
       update.marker-1728 drives a child stub that never exits, so nothing ever
       clears it. The operator's phone then reads "your Mac is updating Kosmos,
       back in a moment" for the full 15-minute cap while nothing is updating:
       this card's own message, inverted, by its own test suite.

       WITHOUT THE ORDERING: an earlier version required ./remote first and
       checked second. Measured, a NODE_TEST_CONTEXT process merely calling
       startPolling() then loaded remote, ping AND store, none of which
       origin/main's update path touches. Both remote.js and ping.js bind
       `const BASE = store.ROOT` at module scope, so the first announce() froze
       the data root for both and newly reached store.root()'s legacy migration
       from the update path. A lazy require moved that freeze from import time to
       first-announce time; it did not remove it. Checking first does.

       The predicate is inlined rather than calling ping.underTest(), which is a
       deliberate reversal: consulting ping would load the very module this
       ordering exists to avoid. It is one boolean against an env var, whose
       single line is the body of ping.js's underTest(), and the exported
       underTest() above still delegates so nothing else copies it.

       Keyed on the TUNNEL-BINARY SEAM (#3626): the call is made under the test
       runner only when a test has pointed AGENT_WORKFORCE_TUNNEL_BIN at its own
       fake tunnel, which touches no network. Without that, the real bundled
       tunnel would run. */
    if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) return;
    /* Still lazy: update.js is required early, and remote.js freezes its root at
       module scope. update.js's autoPref() requires ./autoupdate late for the
       same reason. CITED BY FUNCTION, NOT BY LINE: this comment has carried a
       stale line number three times on this branch, because my own edits to
       update.js moved the require each time and nothing re-checks a number. */
    const remote = require('./remote');
    /* BOTH halves, and the switch is the half that files cannot see. setOn(false)
       writes {on:false} and calls ensure(); it does NOT remove the enrolment,
       which only forget()/retire does. So enrolled() stays TRUE forever on a Mac
       that turned Kosmos Plus off, and gating on it alone would keep POSTing to
       the PAID coordinator, signed by that Mac, after the
       customer switched the feature off. remote.js gates every other "is there
       anything live to say here" question on the switch as well: pendingDevices()
       is `!settings.on || !enrolled()`, ensure()'s `wanted` is
       `read().on && enrolled() && ...`, and status() answers 'the switch is off'.
       This line is that same shape, deliberately.
       read() never throws and returns {on:false} on every error path (ENOENT,
       unreadable, unparseable, non-object), so a damaged settings file fails
       CLOSED here, which is the safe direction for a paid route. */
    if (!remote.read().on || !remote.enrolled()) return;

    /* Fire and forget: not awaited, so announce() returns before the tunnel child
       even starts. The promise never rejects (macRequest resolves every outcome),
       and the .catch is there so a future change cannot turn it into an
       unhandled rejection on the install path. */
    remote.macRequest('POST', ROUTE, { seconds: n })
      .then((r) => { if (!r || !r.ok) logFailure(r && r.because); else lastLogged = null; })
      .catch((err) => logFailure(err && err.message));
  } catch { /* nothing here may reach the caller */ }
}

module.exports = {
  ROUTE,
  DEFAULT_SECONDS,
  announce,
  seconds,
  underTest,
};
