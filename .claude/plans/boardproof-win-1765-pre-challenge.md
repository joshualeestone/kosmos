---
pre_challenge: true
method: challenge-loop
branch: boardproof-win-1765
diff_hash: e91936b4b08493f142febfc13493868942a6f06f9379073aae66899e74ed6f60
validation: substituted (the helper needs yarn, which this Windows box does not have; instead the full node suite, engine/*.test.js and *.test.js, ran at fdd0edb8a and at origin/main 4c3d734c1 with the no-schtasks preload, --test-force-exit and a 180 s per-test limit: branch 21566 tests, 3016 fail; main 21524 tests, 3018 fail; failing names compared, no new failing test; the three new file-level entries are node's force-exit crash on Windows (UV_HANDLE_CLOSING, 35 files on the branch, 36 on main) and those files pass when run without it; every failure seen in a touched file was checked against main by reason)
subdir_audit: passed
timestamp: 2026-10-17T22:37:41Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes. In iteration 7 every WARNING after deduplication repeated a deferred item, and its NITs were applied.
**Total findings:** 0 BLOCKERs, 17 WARNINGs, 7 CONVENTIONs, about 25 NITs
**Fixed:** 19 | **Deferred:** 2 (each re-raised later and deduplicated) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 4 NITs
- [WARNING] tools/kosmos-open-board.js — the comment said the window was protected when it was not --> FIXED (comment; the window itself was fixed in iteration 2)
- [WARNING] tools/kosmos-open-board.js — a board that never answered the wait still got the plain url --> FIXED (refused on an enforcing board; the catch path too)
- [WARNING] tools/windows/kosmos-cli.js — task ran retried a failed check and blamed a down board --> FIXED (no retry; ctx.unreachable)
- [WARNING] cli.token-refused-5333.test.js — one Windows call without its own data folder --> FIXED
- [CONVENTION] three copies of the check wrapper and the "down" regex --> FIXED (boardproof.checkBoard)
- [CONVENTION] the seam skips the check when a fetch is injected --> DEFERRED: tests pin that no production caller injects one; an explicit opt-out would touch about 50 test files
- [NIT] BoardProof sat under the #3996 banner; comment said "below"; the badge read could exceed its bound; the hook memo comment --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 3 NITs
- [WARNING] KosmosLauncher.cs ResolveBoardAddress — the window loaded the plain address after a refusal --> FIXED (NotConfirmed page; reopening asks again)
- [WARNING] KosmosLauncher.cs OpenInBrowserInstead — said "opened in your browser" when nothing opened --> FIXED
- [WARNING] engine/boardproof.js — a reset counted as "nothing there" --> FIXED
- [CONVENTION] plan file name lacked the timestamp --> FIXED (renamed)
- [CONVENTION] commit subjects did not use "<branch> -- " --> FIXED (rewritten before any PR existed)
- [NIT] the CLI's out-of-time wording --> FIXED; badge proof cache, hook memo --> noted

#### Iteration 3
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 new CONVENTIONs (1 repeat of a deferral), 3 NITs
- [WARNING] the browser fallback's wait grew to 120 s for every board --> FIXED (back to 20 s)
- [WARNING] exit code 1 was ambiguous with a node crash --> FIXED (refusal is exit 10, pinned on both sides)
- [WARNING] a stale opener comment --> FIXED
- [WARNING] the plan did not state that pages already signed in stay exposed --> FIXED (Not covered)

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] the signed Kosmos.exe is not rebuilt here --> DEFERRED: a separate release step by instruction; stated in the plan and the PR body
- [WARNING] OpenInBrowserInstead waited with no bound --> FIXED (60 s cap, pinned against the opener's worst case)
- [NIT] a timed-out hook check blocked the next send; test name; header comment --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 2 new WARNINGs (plus 1 deferred item: unreadable board.token, #2007's contract, now in the plan), 0 new CONVENTIONs, 2 NITs
- [WARNING] the window failed open when the opener crashed --> FIXED (NotConfirmed while a token is on disk)
- [WARNING] a cut-off opener was called a refusal --> FIXED (said as unknown)
- [NIT] a comment that the badge re-checks on purpose --> FIXED

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 0 new CONVENTIONs (1 repeat), 4 NITs
- [WARNING] the browser fallback and the window read a failed opener differently --> FIXED
- [NIT] local check failures were blamed on the listener (hook and CLI) --> FIXED

#### Iteration 7
**New findings:** 0 BLOCKERs, 0 new WARNINGs (the 2 raised repeat the iteration 1 and 4 deferrals), 0 CONVENTIONs, 4 NITs (applied: comments, the background resolve fallback, plan wording)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/kosmos-open-board.js | the comment claimed the window was protected | FIXED | iter 1, 2 |
| 2 | 1 | WARNING | tools/kosmos-open-board.js | the wait timeout opened the plain url | FIXED | iter 1 |
| 3 | 1 | WARNING | tools/windows/kosmos-cli.js | task ran retried after a failed check | FIXED | iter 1 |
| 4 | 1 | WARNING | cli.token-refused-5333.test.js | missing WIN_DATA | FIXED | iter 1 |
| 5 | 1 | CONVENTION | three senders | duplicated check code | FIXED | checkBoard |
| 6 | 1 | CONVENTION | hook, cli | the injected fetch skips the check | DEFERRED | pinned by source tests |
| 7 | 2 | WARNING | KosmosLauncher.cs | window loads plain url after a refusal | FIXED | iter 2 |
| 8 | 2 | WARNING | KosmosLauncher.cs | wrong message in the browser fallback | FIXED | iter 2 |
| 9 | 2 | WARNING | engine/boardproof.js | a reset counted as down | FIXED | iter 2 |
| 10 | 2 | CONVENTION | plan | file name timestamp | FIXED | iter 2 |
| 11 | 2 | CONVENTION | commits | subject format | FIXED | iter 2 |
| 12 | 3 | WARNING | KosmosLauncher.cs | 120 s wait for every board | FIXED | iter 3 |
| 13 | 3 | WARNING | opener and launcher | exit 1 ambiguous | FIXED | exit 10 |
| 14 | 3 | WARNING | tools/kosmos-open-board.js | stale comment | FIXED | iter 3 |
| 15 | 3 | WARNING | plan | signed-in pages not stated | FIXED | Not covered |
| 16 | 4 | WARNING | Kosmos.exe | not rebuilt in this PR | DEFERRED | separate release step, stated |
| 17 | 4 | WARNING | KosmosLauncher.cs | unbounded wait | FIXED | 60 s cap |
| 18 | 5 | WARNING | KosmosLauncher.cs | crash fails open | FIXED | token-on-disk rule |
| 19 | 5 | WARNING | KosmosLauncher.cs | cut-off opener called a refusal | FIXED | unknown message |
| 20 | 5 | WARNING | tools/kosmos-open-board.js | unreadable board.token treated as none | DEFERRED | #2007's tested contract; in the plan |
| 21 | 6 | WARNING | KosmosLauncher.cs | browser and window disagree | FIXED | iter 6 |

### NITs (non-blocking, across all iterations)
- The badge re-runs the check on every poll (iterations 2 and 5): kept on purpose, commented.
- NotConfirmed is an empty-string sentinel (iteration 6): works with today's callers.
- Two adjacent comment blocks in the opener (iteration 6).
- The opener's 7.5 s check is not taken out of its --timeout-ms (iteration 3).

### Strengths (across all iterations)
- The C# check matches engine/boardproof.js byte for byte, pinned by a compiled probe and run against the real board.
- The tests drive the production paths against real local listeners and assert no token in any header, body or url, each with a control.
- Every sender fails closed. A failed check is never a "maybe", and never retried.
- Time bounds: each check gets half its send's bound, and the send gets what is left.
