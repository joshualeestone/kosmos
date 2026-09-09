---
method: challenge-loop
branch: livenessbeat-2558
timestamp: 2026-09-09T10:26:26Z
diff_hash: 44d4abeae31626da03a4743560f2e05a3ac1aa80e2df4663d891fbf078d2054a
---

# Challenge-loop proof: livenessbeat-2558

Fixes kosmos#2558. Moves the /api/report liveness beat before the recorded-state
early-return so an authenticated report whose STATE is refused still proves life. A
report-interface resilience fix (#253/#249 lane; the safe slice of #2522 option (a)). No
product/web change.

## Change under review
- server.js: `liveness.seen(who)` moved from after the `if (kept.recorded !== true) return`
  early-return to before it, beside the #2146 activity marker. Comment updated with the
  #2558 rationale.
- server.liveness-refused-2558.test.js: new (3 arms).
- .claude/plans/livenessbeat-2558.md: plan.
Diff: 202 added lines, 5 removed.

## The security invariant (the load-bearing check)
The beat stays AUTH-gated. `who = sender.card.sessionName` is derived only after
`resolveAgentSender` returns `sender.ok === true` (the route refuses at `if (!sender.ok)
return` above it). On an enforcing board a no-credential bare-pane report sets
`denyPaneFallback` and is refused there, so it never reaches the moved beat. Moving the beat
therefore does NOT let an unauthenticated caller beat any agent's liveness (#1968 / the #1946
cross-account spoof surface is not reopened). The only new delta -- authenticated reports
whose STATE was refused -- are genuine proof of life.

## Assert-the-effect
Reverting the beat to its old placement reds ONLY the fix test (age ~3600008ms, beat never
fired) while both controls stay green -- the test catches exactly the bug and the controls
are fix-independent. Verified twice (by me and by the blind reviewer).

## Validation
- node --test server.liveness-refused-2558.test.js: 3/3.
- sibling invariants: server.report-reply-loopback-1968.test.js 5/5,
  engine/status.activewhilewaiting-2146.test.js + server.work-marker-2146.test.js 4/4,
  engine/liveness.test.js. No regression.
- 0 em dashes in the 202 added lines.
- full node suite + test:shell (6j).

#### Iteration 1 (Opus, blind)
Traced the actual handler path (route start 6839, auth gate 6897, `who` at 6899, moved beat
6985, recorded-check 6986) and `resolveAgentSender` (506-538): confirmed an unauthenticated
report is refused before `who` resolves, so the beat is unreachable to it (#1968 preserved,
BLOCKER-level check clears). Confirmed the fix is correct (refused-authenticated now beats,
accepted still beats), no new false-beat (selfreport/activity records stay before the beat in
both orders; enforcing board's denyPaneFallback blocks the only spoof vector; a non-enforcing
board already allowed a foreign-pane accepted-report beat, so no new capability on any #1968
axis). Ran the test 3/3, re-ran the assert-the-effect (only the fix arm reds on revert), and
the sibling suites (1968 5/5, work-marker-2146 4/4). 0 added-line dashes.
- One [NIT]: the plan named only one #2146 suite; fixed to name both precisely.
- No [BLOCKER], no [WARNING]. Verdict: NO NEW FINDINGS - converged (nit addressed).

### Final Ledger
- Iteration 1 (Opus): converged, 0 BLOCKER / 0 WARNING / 1 NIT (plan wording, fixed).
A security-sensitive route change, converged in one rigorous pass: the reviewer independently
traced the auth gate and re-ran the assert-the-effect revert rather than trusting the comment.
