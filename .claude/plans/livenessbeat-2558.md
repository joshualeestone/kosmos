# livenessbeat-2558: beat liveness for any authenticated report, recorded or refused

Fixes kosmos#2558. A report-interface resilience fix in the #253/#249 self-report+liveness
lane; the safe slice of #2522 option (a). No product/web change; server.js report route only.

## The bug
In the /api/report handler, `liveness.seen(who)` sat AFTER the recorded-state early-return
(`if (kept.recorded !== true) return`). The #2146 WORK-activity marker is deliberately
written BEFORE that return (a refused auto-working is still proof of work); liveness was on
the wrong side. So an AUTHENTICATED report whose STATE is refused (a #900 auto-`working` over
a standing needs_you) never beat liveness. A PANELESS agent working under a sticky needs_you
(its only roster tie is `liveness.alive`, #2146's population) could go stale and drop off the
board while alive and reporting.

## The fix
Move `liveness.seen(who)` to BEFORE the early-return, beside the activity marker. By that
line the sender is already AUTHENTICATED (`resolveAgentSender` refuses at `!sender.ok`
above), so it stays auth-gated: an unauthenticated report never reaches the beat, so this
does NOT reopen the #1968 untokened-spoof surface. A report is proof of life by definition,
recorded or refused.

## Scope note (what this is NOT)
This decouples liveness from the STATE handler, not from the AUTH gate. The #2509 outage was
an AUTH-stage refusal (sender could not be identified); an untokened liveness beat would be a
spoofable "agent is alive" signal (#1968), so that case is intentionally left to the merged
detector (#2522 option b). Filed and built as a distinct, safe coupling.

## Test (server.liveness-refused-2558.test.js), proven both ways
- POSITIVE CONTROL: an accepted report beats liveness (the beat works; WHO is right).
- THE FIX: an authenticated report whose STATE is refused (#900 auto-working over a standing
  needs_you) STILL beats liveness. Its control asserts `recorded === false` so this is
  provably the refused path.
- SECURITY CONTROL: an unauthenticated report (enforcing board, bare pane, no token) is
  refused at auth and does NOT beat liveness (#1968 preserved).
Assert-the-effect: reverted to the unmodified beat placement and confirmed ONLY THE FIX test
reds while both controls stay green -- the test catches exactly the bug, the controls are
fix-independent.

## Validation
- node --test server.liveness-refused-2558.test.js: 3/3.
- sibling suites unaffected (report-reply-loopback-1968, activewhilewaiting-2146).
- full node suite + test:shell (6j); blind challenge-loop; 0 em dashes.
