---
pre_challenge: true
method: challenge-loop
branch: updating-signal-988
diff_hash: 021f8bf341bf6b02de0c40a2ee99a217f8b7f32efaff4cf5a38596c8157f99f1
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T21:12:02Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes. Iteration 16 returned two WARNINGs and both deduplicated against DEFERRED
ledger entries (6c rule 3), leaving zero NEW findings and no unresolved ASKED findings.
**Total findings:** 53 (4 BLOCKERs, 36 WARNINGs, 1 CONVENTION, 12 NITs)
**Fixed:** 39 | **Deferred:** 6 | **Filed as a separate card:** 1 (kosmos#2503) | **Asked:** 0

### 🛑 Two honest limits on this artifact, stated before the detail

**1. The reviewer model for iterations 1 to 13 is `unknown`, and that is a real gap.** This session
was compacted mid-loop and the model per pass was never written outside the context. Alternation was
practised throughout, but I will not reconstruct which pass was which from memory. Iterations 14, 15
and 16 are recorded because they ran after the compaction. So the kosmos#2032 multi-model claim is
**verifiable only for the last three passes**, where it holds (sonnet, opus, sonnet).

**2. The per-iteration breakdown below is recovered from the branch's own commit log**, not from a
ledger held in context. Each iteration has exactly one commit whose message states that iteration's
findings and the measurement behind each. That is contemporaneous evidence rather than recall, and
it is checkable: `git log --format='%h %s%n%b' origin/main..HEAD`. Where the commit message did not
record something (the Self-generated counts, mainly), this file says so instead of filling it in.

### Per-Iteration Breakdown

#### Iteration 1 (47845fb6)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 BLOCKER, 5 WARNINGs
**Self-generated:** 0 (nothing of the loop's own had committed yet)
- [BLOCKER] engine/updating.js - no underTest() guard, so the SUITE reached the real coordinator with the Mac's client certificate; measured at 20 real POSTs --> FIXED (47845fb6)
- [WARNING] engine/update.js - the eager require('./updating') gave update.js a load-time path to remote.js, which freezes the data root at module scope --> FIXED (47845fb6)
- [WARNING] engine/updating.js - the test seam replaced the whole send rather than the transport, so enrolment and cert reads were never exercised --> FIXED (47845fb6)
- [WARNING] engine/updating.js - every outcome discarded, so a 401 or a 404 is indistinguishable from success forever --> FIXED (47845fb6)
- [WARNING] engine/update.js - the boot clear was a single unretried request at the busiest moment --> DEFERRED: retrying adds a second failure mode to the install path
- [WARNING] engine/updating.js - an http:// coordinator was silently dead (ERR_INVALID_PROTOCOL swallowed) --> FIXED (47845fb6)

#### Iteration 2 (90443d70)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** not recorded at the time
- [WARNING] engine/updating-988.test.js - an arm named "a state dir whose certificate has vanished says nothing" did not measure that --> FIXED (90443d70)
- [NIT] engine/updating.js - a claim of mine about `agent:false` outran its measurement --> FIXED (90443d70)

#### Iteration 3 (9b9eed05)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 2 BLOCKERs, 3 WARNINGs
**Self-generated:** not recorded at the time
- [BLOCKER] engine/update.js - the clear never fired for a real installer failure: the spawned shell's exit status is its trailing `if`, so `code !== 0` is false on ordinary failures --> FIXED (9b9eed05)
- [BLOCKER] engine/updating.js - the error handler the fail-open guarantee rests on had no coverage --> FIXED (9b9eed05)
- [WARNING] engine/update.js - two of the five call sites had no arms --> FIXED (9b9eed05)
- [WARNING] engine/updating-988.test.js - an arm named "repeats once on the first tick" could not tell "once more" from "every 60 seconds forever" --> FIXED (9b9eed05)
- [WARNING] engine/updating.js - AGENT_WORKFORCE_TUNNEL_CA is documented as relay-only and the comment said otherwise --> FIXED (9b9eed05)

#### Iteration 4 (560929cb)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** not recorded at the time
- [WARNING] engine/updating-988.test.js - the enrolment gate was never distinctly exercised; deleting it left the suite 33/33 green, because the fixture fell through to the cert-read catch --> FIXED (560929cb)
- [NIT] engine/updating.js - a comment cited update.js:254 for the late require('./autoupdate') and the line was wrong --> FIXED (560929cb)

#### Iteration 5 (05ad2cc1)
**Reviewer model:** unknown (pre-compaction). The reviewer ran 40 mutations; 24 were already caught.
**New findings:** 6 WARNINGs
**Self-generated:** not recorded at the time
- [WARNING] engine/updating.js - the require sat ABOVE the under-test guard, so the update path dragged remote, ping AND store into every process --> FIXED (05ad2cc1)
- [WARNING] engine/update.js - the boot clear had no installedRoot() gate, unlike every other durable path in the file --> FIXED (05ad2cc1)
- [WARNING] engine/updating-988.test.js - the body assertion read the seam's argument, not the wire; three mutations that break the real body stayed green --> FIXED (05ad2cc1)
- [WARNING] engine/updating.js - the real protocol dispatch had NO coverage --> FIXED (05ad2cc1)
- [WARNING] engine/updating-988.test.js - the header claimed a broken coordinator derivation is visible and it was not --> FIXED (05ad2cc1)
- [WARNING] engine/updating-988.test.js - a module-block comment stated behaviour the code does not have --> FIXED (05ad2cc1)

#### Iteration 6 (450df275)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 WARNING
**Self-generated:** 1 of 1. The commit says so in its own words: the invariant added in iteration 5 had no arm.
- [WARNING] engine/updating.js - the guard-ordering invariant added in iteration 5 had NO ARM; moving the require back above the guard restored the historical bug and left all 43 tests green --> FIXED (450df275), armed with a CHILD-process arm

#### Iteration 7 (b7bda7a1)
**Reviewer model:** unknown (pre-compaction). 41 mutations, 34 already caught.
**New findings:** 4 WARNINGs
**Self-generated:** 3 of 4 by the commit's own account ("three of the seven survivors were arms I wrote to cover the previous two rounds' fixes")
- [WARNING] engine/update.js - the first-tick clear's installedRoot() gate was uncovered --> FIXED (b7bda7a1)
- [WARNING] engine/updating.js - the "NO ca OPTION" decision had a twelve-line rationale and no arm --> FIXED (b7bda7a1)
- [WARNING] engine/updating-988.test.js - a CONTROL arm caught nothing in the entire 41-mutation sweep --> FIXED (b7bda7a1)
- [WARNING] engine/updating.js - the update.js:275 line citation was stale again --> FIXED (b7bda7a1)

#### Iteration 8 (4497a2bd)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 WARNING
**Self-generated:** 1 of 1 (the comment was the loop's own)
- [WARNING] engine/updating.js - a comment misled by PLACEMENT rather than content: the block titled "THE GUARD THAT KEEPS THE SUITE OFF THE REAL COORDINATOR" sat above underTest(), which is not the production guard --> FIXED (4497a2bd)

#### Iteration 9 (18ea978e)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1 of 4 (the comment NIT)
- [WARNING] engine/updating.js - THE PRODUCTION TRANSPORT WAS NEVER EXERCISED. Making the feature completely inert on a real Mac left the whole suite green: the card's deliverable had zero coverage --> FIXED (18ea978e), END TO END arm added
- [WARNING] engine/updating.js - seconds() was proven correct and NOT proven wired --> FIXED (18ea978e)
- [NIT] engine/updating-988.test.js - the begin-announce arm asserted only `n > 0` --> FIXED (18ea978e)
- [NIT] engine/updating.js - a comment said what the code does not do, the same class already fixed once on this branch --> FIXED (18ea978e)

#### Iteration 10 (044e19cd)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 2 WARNINGs, 1 NIT
**Self-generated:** not recorded at the time
- [WARNING] engine/updating-988.test.js - the end-to-end arm's child had no timeout, so a regression HANGS the runner instead of failing it --> FIXED (044e19cd)
- [WARNING] engine/updating.js - the socket hold on req.destroy(); I published a WRONG REBUTTAL here and three fixes for it failed --> resolved at iteration 11 as an instrument error, not a product one
- [NIT] engine/updating.js - res.resume() survived mutation and lacked the disclosure its two neighbours carry --> FIXED (044e19cd)

#### Iteration 11 (ba2f31df)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 1 of 2 (the correction is to my own comment)
- [BLOCKER] engine/update.js - the first-tick clear cancelled the banner of an install that was still running. Measured sequence [0,900,0] --> FIXED (ba2f31df)
- [WARNING] engine/updating.js - A CORRECTION TO MY OWN COMMENT: I documented a 3s socket hold as an accepted cost and rejected three correct fixes on it. All four measurements were one broken instrument (execFileSync blocks the measuring process's event loop). With spawn the child exits at 16ms --> FIXED (ba2f31df)

#### Iteration 12 (d173a83c)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 WARNING
**Self-generated:** 1 of 1
- [WARNING] engine/updating-988.test.js - the END TO END arm drove its child with execFileSync from the same process hosting the server it asserts against, so it measured a timeout rather than a round trip --> FIXED (d173a83c)

#### Iteration 13 (5a3534ef, 009ab56a)
**Reviewer model:** unknown (pre-compaction)
**New findings:** 2 WARNINGs, 1 CONVENTION
**Self-generated:** 1 of 3
- [WARNING] engine/updating-988.test.js - nine startPolling call sites could let a tick curl the real release host from every agent's suite run --> FIXED (5a3534ef), one global fetcher injection
- [CONVENTION] engine/updating.js - `underTest` and `dispatch` pass the #265 orphan sweep by NAME COLLISION rather than by reachability --> FIXED (5a3534ef)
- [WARNING] engine/update.js - the two announce(0) clears carried no owner-identity guard, though noteAttemptEnd makes exactly that check ten lines away --> FIXED (009ab56a). My FIRST version of this fix was UNARMED: removing both guards left the suite green. Found by perturbation and armed with a superseded-child arm.

#### Iteration 14 (8aa3e8fb)
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0 of 2 (both cite code from the original implementation)
- [WARNING] engine/updating.js - announce() gated on remote.enrolled() alone, never on the Plus switch. setOn(false) does not unenrol, so a Mac that switched Plus off keeps POSTing to the PAID coordinator with its client certificate --> FIXED (8aa3e8fb). Verified in the source before acting: setOn writes {on} and calls ensure() and nothing else; pendingDevices() and ensure() both gate on the switch. Armed: adding the gate turned 30 of 50 arms red.
- [NIT] engine/updating-988.test.js - the SANDBOX mkdtemp was never removed, unlike seven sibling suites --> FIXED (8aa3e8fb)

#### Iteration 15 (2b3894d5)
**Reviewer model:** opus
**New findings:** 5 WARNINGs, 6 NITs (2 WARNINGs deduplicated on the spot)
**Self-generated:** 2 of 11 (the unarmed owner guard from iteration 13, and its comment)
- [WARNING] engine/update.js - the `code !== 0` bookkeeping block is dead in production, by the same masking this card measured. PRE-EXISTING on main --> FILED as kosmos#2503 rather than widening this card; cross-referenced from the code
- [WARNING] engine/update.js - the error-listener owner guard is NOT ARMED --> MEASURED MYSELF (replacing `mine` with `true` leaves 88/88 green) and CONFIRMED unreachable under single-flight. Guard kept for symmetry; the comment corrected to say unarmed BY CONSTRUCTION, since it had been describing the EXIT listener's scenario
- [WARNING] engine/updating.js - DEFAULT_SECONDS equals the cap --> DEFERRED as premise five; the FALSE COMMENT was new and is FIXED, as is an arm whose NAME repeated it
- [WARNING] engine/update.js - the begin-announce races the board's own shutdown --> DEDUPLICATED: plan premise four
- [WARNING] engine/updating-988.test.js - three arms assert exact counts inside fixed wall-clock windows --> FIXED (2b3894d5). And the sharper half the reviewer did not name: two OTHER arms assert ABSENCE, which is what a run with no tick also produces. They now WITNESS a tick through the fetcher
- [NIT] engine/updating.js - Math.trunc maps every 0<v<1 to 0, the FINISH signal --> A REAL CORRECTNESS BUG, not a nit. Measured: seconds(0.5), (0.9), (0.0001) all returned 0 --> FIXED (2b3894d5), armed, perturbation reds exactly that arm
- [NIT] engine/updating-988.test.js - arms depended on a prior arm's afterEach writing remote.json --> FIXED (2b3894d5) with a beforeEach
- [NIT] engine/updating-988.test.js - state resets sat after assertions rather than in a finally --> FIXED (2b3894d5)
- [NIT] engine/updating-988.test.js - the E2E arm is http only, so mTLS has no integration coverage --> DEDUPLICATED: the stated weakest premise
- [NIT] engine/updating.js - a log line per boot on an undeployed route --> DECIDED, NOT CHANGED. Reason and reversal condition in the plan
- [NIT] - the paste-the-install-line path bypasses the board entirely --> DEFERRED: out of scope for the engine half, now stated in the plan

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved or deliberately deferred):** 2
**Converged** - the two WARNINGs it raised (DEFAULT_SECONDS at the cap; the two announce races) both
match DEFERRED ledger entries recorded as plan premises three, four and five, and the reviewer
itself described them as documented and intentional rather than as defects.

### What the loop found that tests could not

Four BLOCKERs, and every one of them would have shipped:
1. The suite itself POSTing `{"seconds":900}` to the real coordinator with the operator's client
   certificate. **Not a self-catch: a blind reviewer found it.**
2. The clear placed inside `if (code !== 0)`, which never runs in production because the spawned
   shell's exit status is its trailing `if`.
3. The first-tick clear cancelling the banner of an install that was still running, measured as
   the sequence [0,900,0].
4. The error handler the whole fail-open guarantee rests on having zero coverage.

**Six times on this branch I fixed a real defect and shipped it with nothing that could see it
return** (iterations 4, 6, 7 twice, 13, 15). The pattern is the single most repeated finding here,
and it is why every fix from iteration 13 onward was perturbation-tested: delete the fix, run the
suite, confirm it reds.

**Once I published a wrong rebuttal against a correct finding** (iteration 10) and had three fixes
for it fail, before learning at iteration 11 that all four measurements were one broken instrument.

### Deferred, with reasons

| # | Finding | Why not fixed |
|---|---------|---------------|
| 1 | No retry on a lost announce | Retrying adds a second failure mode to the install path |
| 2 | No `ca` option for the coordinator | That env var is documented relay-only, and setting `ca` REPLACES the trust store |
| 3 | begin/clear ordering race across two processes | Needs a sequence number the route's contract does not have |
| 4 | begin-announce races the board's own shutdown | Waiting for the response would violate the fail-open constraint |
| 5 | DEFAULT_SECONDS equals the server cap, no renewal | A renewal timer adds a second moving part to the install path |
| 6 | The paste-the-install-line path sends nothing | Out of scope: this card is the engine half |

### Weakest premise of the whole branch

**The coordinator route is merged but deliberately NOT deployed, and the end-to-end arm runs over
http.** So the REQUEST is verified (method, path, body, client cert wired, timeout, fail-open on
every error shape) and neither the response nor the mTLS handshake is. What would change this: the
route reaching a reachable environment, at which point one end-to-end arm is worth more than five
unit arms.
