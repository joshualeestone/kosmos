---
pre_challenge: true
method: challenge-loop
branch: wkdownload-5167
diff_hash: 81d8746b28d1974122151b4587815681b6dad72f9ce452a28076fa9c50940047
validation: pending (full suite queued after this proof; focused runs green, see below)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T00:23:27Z
iterations: 40
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 40
**Converged:** No. Stopped at the iteration-40 safety valve (STOP-ITERATION-VALVE, iteration count = 40).
**Who stopped it:** April, not the user. The valve pause went unanswered for 1.5 h; Josh's standing ruling
(night-shift step 3, 2026-08-31 22:28: "make a recommendation, implement that, and continue forward") is
to decide a reversible call rather than wait. Stopping is reversible: nothing merges, more rounds can run.
**Total findings:** about 200 across 40 rounds (exact per-finding counts were not kept in one ledger).
Every round from 1 to 40 found at least one new actionable item. Four were real security defects (rounds
3, 17, 23, 37). Nearly all were fixed; about a dozen were deliberately not changed, with reasons in
`.claude/plans/wkdownload-5167.md` ("Not changed" lines per round). None is ASKED.

### Per-Iteration Breakdown

Reviewer model alternated each round: odd rounds opus (the default), even rounds sonnet.
**Self-generated:** not computed. The 6c-bis blame lookup was not run per finding; most late findings
were in code earlier rounds added (the alert and rate-limiting machinery), by reading, not by the lookup.

- [BLOCKER] round 1: long extension crashed downloadDestination --> FIXED 5f742b6b
- [WARNING] round 3: a foreign site in the window could save its own files --> FIXED bfdb003e (isBoardPage)
- [BLOCKER] round 17: a hostile Kosmos+ name holder could save without asking --> FIXED 58d71617 (per-computer Allow)
- [WARNING] round 23: Return answered Allow on a page-timed question --> FIXED b294c0a4
- [BLOCKER] round 31: the board's 204 refusal was saved as an empty file --> FIXED 1b2d155d
- [WARNING] round 37: a covering alert let a click land on an awake Allow --> FIXED a20682c7
- [WARNING] round 40: a refusal in new words could be folded into a generic summary --> FIXED f4f990e8
- Every other round's findings and decisions: `.claude/plans/wkdownload-5167.md`, "Review round N changes".

### Final Ledger (decisions kept, not changed)

| Round | Finding | Status | Reason |
|---|---|---|---|
| 2 | no user-gesture rule on a same-origin download | DEFERRED | #5165's own download is a script click |
| 4, 7 | no-console build box skips the live gate | DEFERRED | same bargain as the #1032 file-picker gate |
| 5 | a run computer's window loads any foreign link | DEFERRED | pre-existing, filed as #5169 |
| 12, 34 | one quiet window and one summary per page | DEFERRED | decided rule, recorded in the plan |
| 16 | reserved-name copy can drift from the relay | DEFERRED | no cross-repo check runs here; count pinned |
| 19, 22 | Don't Allow lasts the run (View > Reload asks again) | DEFERRED | a page cannot keep re-asking |
| 36 | the cap counts files, not bytes | DEFERRED | the person allowed that computer |

### Outstanding questions (ASKED)
None.

### Validation at this head (f4f990e8f)
- `node --test` over 39 files (the download test, every native-app test, every test that reads main.swift
  or the bundle build, repo-wide audits): 787 tests, 782 pass, 0 fail, 5 skipped.
- `--kosmos-app-mode-selftest`: 86 rows, all good. `--kosmos-app-download-selftest` (real WKWebView): 25 rows,
  all good, about 55 s.
- Full suite: queued after this proof (validation-carry said NEEDS-FULL).

### Weakest premise
Never measured over a live Kosmos+ tunnel in connect mode; the live selftest runs as a computer that runs
agents, against a loopback server.

### Strengths (across rounds)
- Pinned @objc selectors and a live selftest that proves WebKit calls them, with sabotage arms that turn red.
- File names cleaned against separators, hidden dots, direction and invisible characters, byte caps, and
  never overwriting (dangling symlinks and in-flight names included).
