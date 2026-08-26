---
pre_challenge: true
method: challenge-loop
branch: app-reload-965
diff_hash: 64401dfedbdcab7efbc0ac9659508c1e90812014731fbd0e79be9924d5b608a9
subdir_audit: passed
timestamp: 2026-08-26T14:44:24Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** Yes (iteration 11: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs; 3 NITs, 2 taken post-convergence, 1 already documented)
**Total findings:** 33 (0 BLOCKERs, 14 WARNINGs, 4 CONVENTIONs, 15 NITs)
**Fixed:** 29 | **Deferred:** 4

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] main.swift startBoard blocks the main thread on a Cmd-R recovery --> FIXED (background queue + UI marshaled back, 1261125)
- [WARNING] main.swift -999 cancellations flag a healthy page as failed --> FIXED (NSURLErrorDomain/-999 carve-out, 1261125)
- [WARNING] main.swift board-died-after-load needs two presses --> FIXED (one-shot fall-through, 1261125)
- [WARNING] main.swift undrained child pipes can deadlock waitUntilExit --> FIXED (nullDevice stdout + drain-before-wait, 1261125)
- [NIT] negative test-seam value silently ignored --> FIXED (rejection logged)
- [NIT] extract branch predicate + selftest hatch --> superseded by iteration 4's CONVENTION (implemented there)
- [CONVENTION] plan checklist committed mid-flight --> FIXED (checklist updated)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
- [WARNING] one-shot not consumed in didFail, leaks across navigations --> FIXED (fires from both delegates, disarmed at every loadBoard, commit for iter 2)
- [WARNING] boardStartInFlight has no failsafe; hung start kills Reload forever --> FIXED (watchdog + generation counter)
- [NIT] dropped press during boot invisible --> FIXED (beep + documented drop-not-queue)
- [NIT] Double("inf") passes the seam gate --> FIXED (isFinite)

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] watchdog does not bump generation; a stale failed start can alert over a healthy page --> FIXED (bump on re-arm; late lone success dropped, cost stated)
- [NIT] webView.url non-nil during uncommitted provisional load; reload() is a no-op there --> FIXED (gate on backForwardList.currentItem)
- [NIT] crashed WebContent process is the one blank state with no log line --> FIXED (webViewWebContentProcessDidTerminate logs)

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
- [WARNING] benign -999 leaves the one-shot armed indefinitely --> FIXED (disarm in the carve-out, later refined by iteration 5 attribution)
- [WARNING] watchdog abandons the hung work (leaked thread + orphan child per attempt) --> FIXED (onSpawn hands the Process to a generation-keyed slot; watchdog reaps)
- [CONVENTION] the reload decision has no automated regression guard --> FIXED (pure reloadDecision + --kosmos-app-reload-decision-selftest hatch; wired into the build in iteration 6)
- [NIT] startBoard-branch log prints a contradictory url --> FIXED (prints the actual predicate)

#### Iteration 5
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] reap comment overclaims (grandchild-fd hang unreachable by SIGTERM) --> FIXED (comments claim only the re-arm; residual cost stated at both sites)
- [WARNING] a -999 for a superseded navigation disarms the reload's own one-shot --> FIXED (WKNavigation token attribution through one shared failure handler)
- [WARNING] a slow boot crossing the watchdog dies silently (blank window) --> FIXED (300s ceiling, stated as asserted-not-measured; loud alert on fire)
- [CONVENTION] em dash in the plan file --> FIXED
- [NIT] duplicated fall-through blocks in both delegates --> FIXED (one shared handler)
- [NIT] stale quoted log-line shape in earlier plan section --> FIXED (annotated)

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] an unrelated navigation failure robs a healthy committed page of plain reload --> FIXED (lastLoadFailed set only for on-screen-relevant failures)
- [WARNING] watchdog terminate() without an isRunning guard (recycled-pid TOCTOU) --> FIXED (guard + honest log per case)
- [CONVENTION] the decision-table hatch is wired to nothing --> FIXED (build script diffs the eight-row table at build time; check replayed against the real binary)
- [NIT] alert headline contradicts body --> FIXED (title parameter, "Kosmos is still starting")
- [NIT] nil-token fallback preserves an unattributed window --> FIXED (disarm at the call site)

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
- [WARNING] ms-wide uncommitted window spawns one redundant fast health-check start --> DEFERRED: documented on reloadDecision as accepted, self-limiting cost; a fourth state-machine input buys complexity, not correctness
- [NIT] didFinish blanket-clear asymmetry undocumented --> FIXED (comment)
- [NIT] build check folds stderr into the compared table --> FIXED (stdout-only compare)
- [NIT] watchdog alert names only the keyboard entry point --> FIXED (names View > Reload too)

#### Iteration 8
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
- [WARNING] leak ACCUMULATION unbounded if the cross-file invariant regresses --> FIXED as documentation: accumulation explicitly accepted with its bound and tripwire; a firing cap would guard a regression two layers deep
- [NIT] nil-token press is a silent no-op --> FIXED (falls through to loadBoard)
- [NIT] isRunning comment overclaims TOCTOU closure --> FIXED (narrowed, not closed)
- [NIT] failed-to-run branch discards the binary's stderr --> FIXED (kept aside, printed on failure)

#### Iteration 9
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] reinstall-first alert wording reachable mid-session from Cmd-R --> FIXED (user-initiated attempts suggest retry before reinstall; launch wording verbatim)
- [WARNING] recovery load failing over an old committed page leaves the next press on the wrong branch --> FIXED (boardLoadNavigation token; its failure sets lastLoadFailed)
- [CONVENTION] build-script temp file bypasses the script's ONE-EXIT-trap invariant --> FIXED (rides the trap)
- [NIT] "press Cmd-R" through an app-modal alert --> FIXED ("Click OK, then...")
- [NIT] comment claims a page was "established" where it was checked --> FIXED
- [NIT] attribution comment self-contradicts --> FIXED

#### Iteration 10
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
- [WARNING] hatch invocation hangs (not fails) on flag drift, headless build wedges --> FIXED (perl-alarm timebox on BOTH selftest invocations; drift simulated live, exit 142 at the alarm)
- [NIT] drift branch prints only the actual table --> FIXED (prints EXPECTED and ACTUAL)
- [NIT] possible // in mktemp path when TMPDIR ends with a slash --> DEFERRED: cosmetic, matches existing house patterns
- [NIT] seam-driven reload beeps in a headless test run --> DEFERRED: test-only env var, understood and harmless

#### Iteration 11
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** -- no new actionable findings.
- [NIT] perl exec-failure masks as success --> FIXED post-convergence (exit 127 after exec; exec-fail path proven, exit 127)
- [NIT] clean-slate clear means one doomed reload hop when a fall-through's start fails --> FIXED post-convergence (cost documented at the clear site)
- [NIT] 300s watchdog kills a >300s healthy cold boot before the alert --> DEFERRED: the tradeoff is already documented at the site (asserted-not-measured ceiling, loud firing, self-healing retry)

### Final Ledger (fixed items grouped by theme)

| # | Iter | Category | Area | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | main.swift | main-thread block on recovery | FIXED | async start, marshaled UI |
| 2 | 1 | WARNING | main.swift | -999 poisons failure flag | FIXED | benign carve-out |
| 3 | 1 | WARNING | main.swift | two-press board-died case | FIXED | one-shot fall-through |
| 4 | 1 | WARNING | main.swift | pipe deadlock in startBoard | FIXED | nullDevice + drain-first |
| 5 | 2 | WARNING | main.swift | one-shot leaks across navs | FIXED | both delegates + disarms |
| 6 | 2 | WARNING | main.swift | hung start kills Reload forever | FIXED | watchdog + generations |
| 7 | 3 | WARNING | main.swift | stale failure alerts over healthy page | FIXED | generation bump on re-arm |
| 8 | 4 | WARNING | main.swift | -999 leaves one-shot armed | FIXED | attributed disarm |
| 9 | 4 | WARNING | main.swift | watchdog abandons hung work | FIXED | onSpawn + reap |
| 10 | 5 | WARNING | main.swift | superseded -999 steals the disarm | FIXED | WKNavigation tokens |
| 11 | 5 | WARNING | main.swift | silent blank window past watchdog | FIXED | 300s + loud alert |
| 12 | 5 | WARNING | comments | reap overclaim | FIXED | honest guarantees |
| 13 | 6 | WARNING | main.swift | unrelated failure robs plain reload | FIXED | on-screen-relevant flagging |
| 14 | 6 | WARNING | main.swift | terminate without isRunning | FIXED | guarded + per-case log |
| 15 | 7 | WARNING | design | redundant start in ms window | DEFERRED | documented accepted cost |
| 16 | 8 | WARNING | design | leak accumulation unbounded | FIXED | explicit accepted bound |
| 17 | 9 | WARNING | UX | reinstall-first advice mid-session | FIXED | retry-first for presses |
| 18 | 9 | WARNING | main.swift | recovery-load failure not attributed | FIXED | boardLoadNavigation |
| 19 | 10 | WARNING | build | hang-on-drift hatch invocation | FIXED | perl-alarm timebox |
| 20 | 1 | CONVENTION | plan | checklist mid-flight | FIXED | updated |
| 21 | 4 | CONVENTION | tests | decision logic unguarded | FIXED | pure fn + wired hatch |
| 22 | 5 | CONVENTION | style | em dash in plan | FIXED | removed |
| 23 | 9 | CONVENTION | build | temp file off the EXIT trap | FIXED | rides the trap |

### NITs (all iterations; 15 total, 12 fixed, 3 deferred as documented above)
Notable fixed: seam value validation (negative, non-finite), beep on dropped press, shared failure handler, predicate log line, modal-aware alert copy, stdout-only table compare with stderr kept for the failure branch, expected+actual drift output, perl exec guard, comment accuracy passes.

### Strengths (recurring across all 11 reviews)
- The pipe-deadlock fix called textbook-correct by five independent reviewers, with the cross-file dependency (install/kosmos nohup fd redirection) named at the site.
- The generation-counter watchdog verified race-clean under tracing by four reviewers; all state main-thread-confined, no locks needed.
- reloadDecision as a pure function with a build-time-diffed eight-row table: the state machine cannot drift silently.
- WKNavigation token attribution with the explicit nil guard (nil === nil trap) called out as load-bearing and correctly closed.
- The plan's verification record repeatedly praised for honesty about its own limits (check C's qualified claim, asserted-not-measured ceilings, accepted costs stated with rationale).
