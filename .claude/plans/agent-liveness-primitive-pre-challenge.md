---
pre_challenge: true
method: challenge-loop
branch: agent-liveness-primitive
diff_hash: ae8d5fa639b3a25f1237634b90c206eb67db636924b5ebad416fdbf44ff270e3
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T22:01:02Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 10 (1 BLOCKER, 4 WARNINGs, 1 CONVENTION, 4 NITs) + 6 STRENGTHs
**Fixed:** 8 | **Deferred:** 2 | **Asked (awaiting user):** 0

The per-agent liveness primitive: #1930 (one-directional auth_failed freshness guard),
#2019 (honest restart-timeout verdict), #2146 (additive activeWhileWaiting coexistence
flag). Engine + server only; the web renders are owned by Mona Lisa (#2019 timedOut) and
Angel (#2146 / #2157). Field shapes signed off by Pete and Angel before build.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 NIT
- [BLOCKER] server.js/status.js - the activeWhileWaiting heartbeat leg read the generic liveness beat, which the report route wrote on EVERY report incl. the Stop hook's end-of-turn `report idle`, so a needs_you agent that merely finished a turn read activeWhileWaiting:true one tick after asking --> FIXED (65e79d19): replaced with a WORK-SPECIFIC marker (activity.js key 'working') written only on a `working` report, freshness-bounded; server work-marker test with an idle control.
- [WARNING] status.js - #1930 baseline was cleared only on a non-HEALTHY auth_failed scrape, so it persisted across a recovery and a later stale 401 could re-haunt --> FIXED (65e79d19): clear on any owned non-auth_failed scrape; test added.
- [WARNING] status.js - authErrorLineCount (the actual #1930 signal generator) had no unit test --> FIXED (65e79d19): counts real 401 lines, excludes prose-mention (#1233) and the friendly line (#1884), strips glyphs, null-safe.
- [NIT] status.js - timedOut disruption record persists on disk / no distinct terminal failure state --> DEFERRED: intended per #2019 ("never doesn't-exist"; "not come back yet" is the honest failure message; inert once the pane is gone).

#### Iteration 2
**New findings:** 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] status.js - a fixed-baseline compare kept firing "a live rejection loop is running" on a recovered-but-idle agent whose old 401 lines lingered in the captured tail (the exact haunt #1930 removes) --> FIXED (d68be68e): PER-TICK DELTA (compare against the previous tick's count, not the healthy-transition baseline), so a static count no longer fires and base HEALTHY-suppression resumes.
- [WARNING] server.work-marker-2146.test.js - no e2e test for the load-bearing "refused auto-working over a standing needs_you STILL writes the marker" path --> FIXED (d68be68e): added the route-level refused-working test (recorded:false AND marker exists).
- [CONVENTION] disruption.js:121 - active() doc described superseded revert-to-absence behavior --> FIXED (d68be68e): documents the #2019 timeout carry-forward.
- [NIT] status.js - authErrorLineCount parity claim ("same wholeOnOneRow criterion") overstated (does not count wrapJoined) --> FIXED (d68be68e): clarified it counts only the single-row form (undercounts conservatively, fails toward suppression).
- [NIT] status.js - activeWhileWaiting can read true up to ACTIVE_WORK_STALE_MS (180s) after the last working beat --> DEFERRED: bounded, additive, the freshness-window tradeoff; only ever set by a genuine working report.

Between iterations 2 and 3 a peer-review thread with Pete (pigeonpete) pressure-tested the
per-tick-delta change and surfaced TAIL SATURATION (a fast loop pins the bounded-tail count
at its ceiling so the delta reads ~0). Resolved: a recovered-idle agent's saturated lines
also never scroll off, so the two are indistinguishable by any bounded-tail count; #1930's
additive/never-false-alarm-a-healthy-idle doctrine forbids the permanent haunt a ceiling arm
would cause; the hot-loop miss is transient and bounded by authprobe.TTL_MS (30s) with rule
3b as the closer. Documented in status.js (77cfc3b6, aaae27fd).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (2 duplicates of already-deferred items)
**Converged** - no new actionable findings.
- [NIT] status.js - timedOut disk persistence --> DUPLICATE of iter-1 (DEFERRED).
- [NIT] status.js - activeWhileWaiting 180s freshness lag --> DUPLICATE of iter-2 (DEFERRED).
- [NIT] server.js - the 'working' marker is never explicitly cleared (only ages out), unlike auth-error which clears on recovery; asymmetry undocumented at the write site --> FIXED (51c3379a): documented (freshness-bounded reads ignore stale markers, so nothing to clear; consistent with liveness.js).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js/status.js | heartbeat leg conflated life with work (idle beat false-positive) | FIXED | 65e79d19 |
| 2 | 1 | WARNING | status.js | #1930 baseline not cleared on recovery -> re-haunt | FIXED | 65e79d19 |
| 3 | 1 | WARNING | status.js:1755 | authErrorLineCount untested | FIXED | 65e79d19 |
| 4 | 1 | NIT | status.js | timedOut record disk persistence | DEFERRED | intended per #2019 |
| 5 | 2 | WARNING | status.js | #1930 lingering-red re-haunt (baseline compare) | FIXED | d68be68e |
| 6 | 2 | WARNING | server.work-marker-2146.test.js | no e2e for refused-working-writes-marker | FIXED | d68be68e |
| 7 | 2 | CONVENTION | disruption.js:121 | stale active() doc | FIXED | d68be68e |
| 8 | 2 | NIT | status.js:1755 | authErrorLineCount parity overstated | FIXED | d68be68e |
| 9 | 2 | NIT | status.js | activeWhileWaiting 180s freshness lag | DEFERRED | bounded/additive |
| 10 | 3 | NIT | server.js:5542 | work-marker clear asymmetry undocumented | FIXED | 51c3379a |

### NITs (non-blocking)
- [NIT] status.js timedOut disruption record persists on disk for an agent that never returns (iter 1, 3) - DEFERRED, intended per #2019.
- [NIT] status.js activeWhileWaiting can read true up to 180s after the last working beat (iter 2, 3) - DEFERRED, the intentional freshness window.

### Strengths (across all iterations)
- The one-directional #1930 guard: only `newErrorsSinceHealthy === true` withholds suppression; null/undefined/false/malformed/no-sample all leave base suppression standing, pinned by named (b) dangerous-answer controls.
- The three-answers discipline (found:false vs a real 0) preserved and directly tested, closing the spurious-first-increase false-alarm direction.
- freshestActivity reads ONLY the work marker (never the liveness beat) and is freshness-bounded, excluding the Stop-hook idle false-positive; the idle-writes-no-marker test carries a working-report control.
- The refused-auto-working marker write sits before the recorded-check and is protected by a test, not a comment.
- #2019 self-heal correct in all four arms; the timed-out record never collapses to a bare STOPPED "doesn't exist".
- The strict `>` ask-gate excludes the waiting report's own pinned beat; both legs, the self-trigger control, and worked-then-asked exclusion all tested.
