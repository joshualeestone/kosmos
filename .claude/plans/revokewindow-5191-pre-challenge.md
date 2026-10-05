---
pre_challenge: true
method: challenge-loop
branch: revokewindow-5191
diff_hash: 52882b46b90a7b9d01320d4355879b2e91a533d9e063e53a9fff44e33fe10ec5
validation: engine/fedseats.test.js green at every iteration (103/103 at df42ea5c8 on a blind reviewer's scratch copy); every new control perturbed (several rebuilt after a perturbation stayed green); full suite queued via queued-heavy before the PR
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T03:55:55Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 blind subagent rounds (opus and sonnet alternating) plus one cross-agent review (Angel, card #5191).
**Converged:** Yes, at iteration 13: 0 BLOCKER, 0 WARNING, 3 NIT. Iteration 10 had also converged, and Angel's review after it found a confirmed hole (a found-but-unsaved revoke let the pass release held posts unchecked), so convergence alone was not taken as completeness; three more rounds followed.
**Tallied from the ledger:** 37 WARNING, 5 CONVENTION, 0 BLOCKER rows; 36 fixed, 6 deferred with a stated reason (each deferral is a disclosed residual in .claude/plans/revokewindow-5191.md).

### Disclosed residuals (also in the plan)
- With members left, a post sealed by the revoked member under its old key is still shown inside the 90 s grace (about 75 s, relay-bounded).
- While Kosmos+ is unreachable, the 60 s pass shows held posts unchecked.
- Posts held are lost on a seat stop or restart (memory only).
- A coordinator that deletes an edge instead of marking it non-active is not detected (Angel's unverified premise, #3728 semantics).
- A holder of a still-graced key can fill the held cap; no worse than the minute budget any key holder can already spend.

### Per-Iteration Breakdown
#### Iteration 1 (opus): 0 B, 6 W, 3 C, 2 N. Self-generated: 0 (ITER_COMMITS empty)
- [WARNING] engine/fedseats.js:657: junk envelopes take held places, crowd out a member --> FIXED (5f924e21 (hold only what opens now))
- [WARNING] engine/fedseats.js:637: release loop has no per-line try, one throw loses the rest --> FIXED (5f924e21 (no test: nothing reachable throws; defensive))
- [WARNING] engine/fedseats.js:662: one coordinator request per room --> FIXED (5f924e21 (sharedEdges, Mac-wide per 15 s))
- [WARNING] engine/fedseats.js:636: freshness credited at answer arrival not ask --> FIXED (5f924e21)
- [WARNING] engine/fedseats.js:521: remaining member past 90 s grace dropped silently --> FIXED (5f924e21 (re-send key at once on an old-epoch refusal; post itself = #5192; member grace = #5197))
- [WARNING] engine/fedseats.js:645: "never dropped" false on restart/stop --> FIXED (5f924e21 (comment says memory-only))
- [CONVENTION] engine/fedseats.js:516: rotatedFor written, never read --> FIXED (5f924e21 (field dropped; grace from rooms file))
- [CONVENTION] engine/fedseats.test.js restart: restart test cannot fail (one member) --> FIXED (5f924e21 (two members, 30 s / 91 s))
- [CONVENTION] plan/tests: no tests for cap, junk, many rooms --> FIXED (5f924e21 (cap, junk, two rooms, ask-age, re-send))
- [NIT] heldNoted never resets (FIXED, reset on release); hung check blocks pass (DEFERRED: remote.macRequest has MAC_REQUEST_TIMEOUT_MS).

#### Iteration 2 (sonnet): 0 B, 4 W, 1 C, 4 N. Self-generated: 2 (plan "never worse" + heldNoted reset lines were iteration-1 fixes; acted on as prose/code fixes)
- [WARNING] engine/fedseats.js:675 + plan: "never worse" overstated: posts lag up to 60 s in an outage --> FIXED (plan wording); early release DEFERRED: Renet W2 asked hold-until-pass; early release lets a revoked member through when Kosmos+ is slow (18712b02)
- [WARNING] engine/fedseats.js:681: cap note per check cycle (heldNoted reset) --> FIXED (18712b02 (once a day))
- [WARNING] engine/fedseats.js:678: shared ask stamp: revoke after T seen at T+15 --> FIXED (plan states it; the stated residual) (18712b02)
- [WARNING] engine/fedseats.js:677: clock stepped back = always fresh --> FIXED (18712b02 (isFresh))
- [CONVENTION] engine/fedseats.js:104: exported onEvent takes the hold-skip flag --> FIXED (18712b02 (handleEvent))
- [NIT] double open (DEFERRED, bounded); held replay dedupe (FIXED); unauthenticated re-send comment (FIXED); hung macRequest (DEFERRED, timeout exists).

#### Iteration 3 (opus): 0 B, 2 W, 1 C, 2 N. Self-generated: 2 (holdForCheck lines from iterations 1-2)
- [WARNING] engine/fedseats.js:578/737: new member pinned after revoke-to-zero reopens revoked key (grace from current peers) --> FIXED (c477a401 (drop the revoked key when nobody is left))
- [WARNING] engine/fedseats.js:694: padded copies / stale posts take held places, drop honest posts --> FIXED (c477a401 (hold only what would show: time, seen, id dedupe))
- [CONVENTION] engine/fedseats.js:688 + plan: "junk takes no place" overstated --> FIXED (c477a401)
- [NIT] shared once-a-day note flag (FIXED, no test); seat replaced during check credited (FIXED, no test: needs a stop+recreate mid-check).

#### Iteration 4 (sonnet): 0 B, 4 W, 0 C, 3 N. Self-generated: 1
- [WARNING] engine/fedseats.js:712: joined shared answer: edgeAskedAt later than answer, ~29 s gap --> FIXED (d90235b3)
- [WARNING] engine/fedseats.js:660: post joining an in-flight check: revoke between ask and post --> DEFERRED: bounded by one round trip; documented in the plan residual; a fresh ask per later post would chain asks under traffic
- [WARNING] engine/fedseats.js:224: held posts meet the minute budget on release; revoked member in grace can fill slots --> DEFERRED: same budget and same unattested sender as live posts before #5191; plan states it
- [WARNING] engine/fedseats.js:716: edgeAsk never clears if macRequest hangs --> DEFERRED: remote.macRequest has MAC_REQUEST_TIMEOUT_MS (engine/remote.js ~1004)
- [NIT] minute note suppressed by held note same day (DEFERRED, same message); resend N frames comment (FIXED); HELD_MAX bytes comment (FIXED).

#### Iteration 5 (opus): 0 B, 3 W, 0 C, 3 N. Self-generated: 1 (revokeCheck checked:true early returns, iteration 1)
- [WARNING] engine/fedseats.js:614/621: unreadable rooms record counted as a check --> FIXED (1c5235ee)
- [WARNING] engine/fedseats.js:196/530: held post judged at release time, hold runs out its grace --> FIXED (1c5235ee (judge at max(arrival, rotation)))
- [WARNING] engine/fedseats.js:530: negative age inside grace (clock back) --> FIXED (1c5235ee (all roles))
- [NIT] minute-budget wording (FIXED, plan); test title (FIXED); tests for both fail-open paths (FIXED, 4 controls).

#### Iteration 6 (sonnet): 0 B, 4 W, 0 C, 2 N. Self-generated: 2
- [WARNING] engine/fedseats.js:179/523: comments promise seconds with members left; held post still shown in grace --> FIXED (prose) (b0f999c3)
- [WARNING] engine/fedseats.js:732: unreadable link: post held with no check to free it --> FIXED (b0f999c3)
- [WARNING] engine/fedseats.js:726: held cap drops honest posts in a stale window --> DEFERRED: the room's existing per-minute COUNT budget, shared and unattested before #5191 too (plan states it)
- [WARNING] engine/fedseats.js:532: negative-age guard changes member behaviour --> FIXED (plan documents; fails closed)
- [NIT] double open (DEFERRED); day rollover note twice (DEFERRED, harmless).

#### Iteration 7 (opus): 0 B, 3 W, 0 C, 4 N. Self-generated: 2 (iteration 6's link fallback; iteration 5's keysAt comment)
- [WARNING] engine/fedseats.js:703: unreadable link fails OPEN (iteration 6 fix) --> FIXED (99a581f5 (hold, no ask; first readable pass releases))
- [WARNING] engine/fedseats.js:177: one member: held pre-revoke post refused; comment false; misleading note --> FIXED (99a581f5 (fails closed by decision; comment cut; 'retired' note))
- [WARNING] engine/fedseats.js:698: latency: every post after 15 s quiet waits a round trip --> DEFERRED: by design (plan states it); goes in the PR description
- [NIT] forged resend 4x rate (DEFERRED, bounded, sealed frames only); pass releases while record unreadable (FIXED + test); bad-shape shared answer reused (FIXED, no test: needs two rooms within 15 s); residual comment (FIXED).

#### Iteration 8 (sonnet): 0 B, 3 W (2 dups), 0 C, 2 N. Self-generated: 1
- [WARNING] engine/fedseats.js:201: held post keeps arrival grace: residual +1 pass in an outage, unstated --> FIXED (prose: comment + plan) (834dd558)
- [WARNING] duplicates: hung macRequest (= #21, DEFERRED, remote.macRequest timeout); held cap crowd-out (= #27, DEFERRED).
- [NIT] low-epoch forged envelope gets the 'retired' note (DEFERRED: a forger can only produce a misleading note once per seat; it cannot open); pendingAt for a no-peer room (harmless, min guard).

#### Iteration 9 (opus): 0 B, 2 W, 0 C, 4 N. Self-generated: 2
- [WARNING] engine/fedseats.js:179: keysAt rotation clamp unguarded by any test --> FIXED (1d71686b (test))
- [WARNING] engine/fedseats.js:650: failed answer not shared: N rooms = N requests in an outage --> FIXED (1d71686b)
- [NIT] seat guard on pass path (FIXED, untested); retired note on in-grace forgery (FIXED + test); revokeCheck doc (FIXED); re-send after 15 s untested (FIXED + test).

#### Iteration 10 (converged before Angel)
- [NOTE] 0 BLOCKER, 0 WARNING; not tabled in the ledger, recorded from the handoff. Angel then found a confirmed hole (next section), so convergence was reopened.

#### Cross-agent review (Angel, card #5191 21:56), after convergence
- [WARNING] engine/fedseats.js:645/688: found-but-unsaved revoke: pass releases held posts unchecked (CONFIRMED) --> FIXED (two guards) + test (f1fde932)
- [WARNING] keysAt: posts held across a long gap open under the late rotation's grace --> FIXED (HELD_ROTATION_LAG_MS) + test (f1fde932)
- [WARNING] rotatedAt future: clock-fast rotation reopens the old key later --> FIXED (clamped) + test (f1fde932)
- [WARNING] residual: ~75 s relay-bounded, unstated --> FIXED (comment + plan) (f1fde932)

#### Iteration 11 (sonnet, post-Angel): 0 B, 3 W, 0 C, 2 N. Self-generated: 2
- [WARNING] keysAt lag: 35 s refuses an honest post held through one failed check --> FIXED (80 s) + test (b0ae96aa)
- [WARNING] revokeCheck checked:true w/o listed edges: coordinator answer missing edges counts as checked --> DEFERRED with statement (plan): #3728 semantics, Angel's unverified premise
- [WARNING] residual comment: no-members join-in-flight bound unstated --> FIXED (plan) (b0ae96aa)
- [NIT] onEvent third arg ignored (ok); heldNotedOn coupling (DEFERRED).

#### Iteration 12 (opus): 0 B, 1 W, 0 C, 1 N. Self-generated: 1
- [WARNING] checkRoom release: pass releases a post that arrived after its answer was asked (reproduced) --> FIXED + test (df42ea5c)
- [NIT] plan residual text (FIXED).

#### Iteration 13 (sonnet): 0 B, 0 W, 0 C, 3 N. CONVERGED (no blocker or warning, nothing new above NIT). 103/103 fedseats tests on a scratch copy.
- [NIT] macEdges answer reused up to 15 s across an account change (DEFERRED: configure() clears it; a Kosmos+ account switch inside 15 s is rare and the answer is at most 15 s old); heldNotedOn shares one note a day between two causes (DEFERRED, same sentence, nothing lost); a holder of a graced key can fill HELD_MAX (DEFERRED: no worse than the minute budget any key holder can already spend; disclosure added to the proof).
