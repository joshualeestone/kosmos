---
pre_challenge: true
method: challenge-loop
branch: teamhello-4936
diff_hash: 7bf6b65b3ec319eb42c22d56de8fbf46e1efa268df112811b82f822fcfe97b33
validation: PR CI (decided 2026-10-02 00:30 CDT, Mortals queue 11 suites deep; see plan)
subdir_audit: passed
timestamp: 2026-10-02T09:38:19Z
iterations: 34
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 34 (31 before merging main, 3 after)
**Converged:** Yes (post-merge iteration 3: 0 BLOCKERs, 0 WARNINGs, 0 new CONVENTIONs, 2 NITs)
**Total findings (iterations 5-31, recorded this session):** 9 BLOCKERs, about 75 WARNINGs, 4 CONVENTIONs, many NITs. Iterations 1-4 were recorded before a context compaction; their fixes are commits 2c0c0ad08, 3956cdc83, 982981dad and ce680a529 (two blockers in iteration 1: navigation while the person was elsewhere, and two browser-check asserts that could never fail; one in iteration 2: a block replace of mine that deleted eight team-step helpers, restored byte for byte).
**Fixed:** every BLOCKER and every WARNING except those written into the plan as decided | **Deferred (decided, in plan):** 9 | **Asked (awaiting user):** 0

**Validation, stated plainly:** the full suite was not run locally for this HEAD. Mortals held 11 validation suites at 00:30 CDT (measured with ps there), so a run queued then would not start before the 05:00 hold that precedes the 05:15 freeze. The PR's own CI (node suite, both shell shards, windows, and the browser-checks job, whose selector picks render-teamcreate-4557 for this diff, measured) is the final validation of the exact HEAD that merges, and merge waits for all of it green. The browser check itself has never run end to end; CI's run on both engines is required before merge. Locally: every test file that reads web/index.html (347 files) 3659 pass, 3 load flakes that pass alone here and on origin/main.

### Per-Iteration Breakdown (models alternate opus and sonnet; odd iterations opus)

#### Iterations 1-4
**Reviewer model:** opus, sonnet, opus, sonnet. Blockers listed above; all fixed.

#### Iteration 5 (opus) - 0 B, 4 W
- [WARNING] hello outcomes painted in the success colour --> FIXED 61080f11f
- [WARNING] focus moved to a card the next board poll destroys --> FIXED 61080f11f
- [WARNING] an unconfirmed hello pinned the team live for good --> FIXED 61080f11f
- [WARNING] Back/reopen decisions had no arm that could fail --> FIXED 61080f11f (two arms)

#### Iteration 6 (sonnet) - 0 B, 5 W
- [WARNING] no timeout on the hello fetch --> FIXED 07dbdaeff (30 s, unconfirmed)
- [WARNING] row copy "has not started" overclaimed --> FIXED 07dbdaeff
- [WARNING] focus after a failed Try again went to the row --> FIXED 07dbdaeff
- [WARNING] no arm on 4xx/5xx/throw branches --> FIXED 07dbdaeff (refusals arm)
- [WARNING] all-unconfirmed Back untested --> FIXED 07dbdaeff

#### Iteration 7 (opus) - 0 B, 3 W
- [WARNING] auto-leave dropped picture results --> FIXED c03761df4 (wait for pictures, stay if one failed)
- [WARNING] unseen arm could not fail --> FIXED c03761df4
- [WARNING] retrying any 4xx relied on an unwritten server rule --> FIXED c03761df4 (only 404/409)

#### Iteration 8 (sonnet) - 0 B, 2 W
- [WARNING] no way forward after a failed picture --> FIXED c5f2cdc9a
- [WARNING] live region claimed "marked" with no card --> FIXED c5f2cdc9a

#### Iteration 9 (opus) - 0 B, 4 W
- [WARNING] needs_you / auth_failed members typed into --> FIXED 6aa43525c (tcHelloHeld)
- [WARNING] server reason thrown away --> FIXED 6aa43525c
- [WARNING] late picture moved the screen --> FIXED 6aa43525c
- [WARNING] could_not retries leave not-delivered lines --> DEFERRED (plan: kept, weakest premise named)

#### Iteration 10 (sonnet) - 0 B, 6 W
- status read unbounded; button vanished after a late picture; Back during the picture wait dropped the team; phone width unchecked; held states untested --> FIXED 9c48bedf6. Mark-loop weakness --> FIXED (150 ms re-mark later).

#### Iteration 11 (opus) - 1 B, 6 W
- [BLOCKER] held-member arm expected copy I had changed --> FIXED 95c0e11a1
- held read only before the first try; parallel status reads; quota gate for automatic senders (DEFERRED, filed kosmos#4959); live region timing; lead-row phone overlap; fresh agent at a question (premise for 0.7.17) --> FIXED or recorded, 95c0e11a1

#### Iteration 12 (sonnet) - 0 B, 4 W
- shared read cache in the check; same-team trap; server words on rows; lead delay (DEFERRED, lead-first) --> FIXED a8d918a6d

#### Iteration 13 (opus) - 1 B, 5 W
- [BLOCKER] two check waits read node's `hellos` inside the page (threw, returned at once) --> FIXED 5b940d4dc
- "Team team" copy; message naming a hidden button; `unknown` typed into; could_not reason hidden; poll-timing focus check --> FIXED 5b940d4dc

#### Iteration 14 (sonnet) - 0 B, 2 W
- not-ready holds not retried --> FIXED 01d7855f0; project-add order --> DEFERRED (server queues both)

#### Iteration 15 (opus) - 1 B, 3 W, 1 C
- [BLOCKER] webkit does not focus a clicked button --> FIXED 6a87e2497 (keyboard)
- picture-failed arm counted early; waiting state; retry repaint --> FIXED; [CONVENTION] README row --> FIXED 6a87e2497

#### Iteration 16 (sonnet) - 0 B, 4 W
- unroute before close; leaving not in flight; consolidated layout (DEFERRED, known gap); flicker --> FIXED 88529ca02

#### Iteration 17 (opus) - 1 B, 3 W, 1 C
- [BLOCKER] auto-leave discarded warn/renamedFrom rows --> FIXED a848adecd
- "still making" copy, picture count, silent wait --> FIXED; [CONVENTION] unroute --> FIXED a848adecd

#### Iteration 18 (sonnet) - 0 B, 3 W
- consolidated focus; 6 s wait; untested waiting row and other-team race --> FIXED a591243cc

#### Iteration 19 (opus) - 1 B, 3 W
- [BLOCKER] the review-18 wait loop skipped its gap (6 s not 30) --> FIXED 955094219 (rewritten; simulated with fakes)
- arm could not see it; #panel-agents absent; focus pulled back --> FIXED 955094219

#### Iteration 20 (sonnet) - 0 B, 3 W
- late card focus theft; mark loop not bounded by moving; seat text overlap --> FIXED 1323b59a6

#### Iteration 21 (opus) - 0 B, 2 W
- reload guard ignored greeting; Back dropped a stayed row --> FIXED 1d43d24ce

#### Iteration 22 (sonnet) - 0 B, 2 W
- unconfirmed + row note dropped by Back --> FIXED 297aa7dff; idle team and the reload guard --> DEFERRED (main's rule)

#### Iteration 23 (opus) - 0 B, 3 W
- note promised a move it would not make; another team asked for, then carried off; no held-picture arm --> FIXED 310c877c4

#### Iteration 24 (sonnet) - 1 B, 1 W
- [BLOCKER] waiting arm could never pass (household not in the shim) --> FIXED 67a52ea0d
- askedKey never cleared --> FIXED 67a52ea0d

#### Iteration 25 (opus) - 0 B, 2 W (+1 process)
- stale "still saying hello" message; note named the wrong destination --> FIXED edb5a59d1; check never run end to end --> recorded (PR CI is the gate)

#### Iteration 26 (sonnet) - 0 B, 2 W
- no announcement when the asked team opens; silent Go click --> FIXED c16c5f526

#### Iteration 27 (opus) - 0 B, 1 W
- fake held agents drawn on the board --> FIXED 9df0fbab7

#### Iteration 28 (sonnet) - 0 B, 1 W (+1 duplicate)
- picture failing mid-wait broke the note's promise --> FIXED 6123f38b2

#### Iteration 29 (opus) - 0 B, 3 W
- live region made at use; focus on a plain div; mid-word breaks --> FIXED 4b03eaf3f

#### Iteration 30 (sonnet) - 0 B, 0 W, 4 NITs
- No actionable findings. A wider local run then caught MY review-29 regression (a static `<p>` before `</body>` broke web.consolidated-980's 39-row body): treated as a BLOCKER from validation, FIXED 7c61ff740 (made by script at load), so the loop ran again.

#### Iteration 31 (opus) - 0 B, 0 W, 0 C, 1 NIT
**Converged** - no new actionable findings.

#### Merge with origin/main (#4965, #4959) and post-merge iterations 32-34
The merge changed the diff, so the loop ran again. Merge: unions of the check's surface line, the README row and the team-step CSS; the team step's hello sent as automatic (#4959); sendWakeHello keeps main's inline request.

#### Iteration 32 (sonnet) - 0 B, 3 W
- [WARNING] the check had no arm for automatic or a held hello --> FIXED 1e957d274 (automatic pinned on every hello; held arm)
- [WARNING] a held hello was retried three times --> FIXED 1e957d274 (stop)
- [WARNING] the held row showed the server's raw sentence with an ISO time --> FIXED 1e957d274 (wakeHeldLine)

#### Iteration 33 (opus) - 0 B, 1 W
- [WARNING] README row still said could_not is tried three times and did not name the held arm --> FIXED 003292ac7
- [NIT] postWakeHello placement; its comment omitted `because` --> FIXED 003292ac7

#### Iteration 34 (sonnet) - 0 B, 0 W
**Converged** - no new actionable findings. NITs kept (in plan).

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Decided and recorded in the plan (DEFERRED with reasons)
could_not retries leave not-delivered lines (it.9); quota gate for automatic senders, filed kosmos#4959 (it.11); lead-first delay (it.12); project-membership order (it.14); consolidated layout marks nothing (it.16); idle team and the reload guard (it.22); "(leads the team)" wraps at phone width (it.29); browser check proven by PR CI (23:36 decision); final validation by PR CI (00:30 decision).

### NITs (iteration 31)
- web/index.html tcHelloHeld: a connection_lost member whose reconnect has given up is waited out (about 30 s) rather than stopped at once; unlikely for an agent made seconds earlier.

### Strengths (across iterations)
- Never re-sends a hello that may have arrived; retries only refusals made before any keystroke (could_not, 404, 409), matched against server.js and engine/chat.js.
- Does not type into a member that needs the person, is signed out, at its limit, stopped or not ready; waits out a starting member with a separate allowance (simulated: never-up = 11 looks, 0 sends).
- Every async path re-checks the team generation; Back, reopen and another team are all handled without a stuck flag.
- The browser check holds the lead's answer, counts sends per name in node, and each arm can fail for the reason it names.
