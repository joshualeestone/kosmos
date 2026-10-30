---
pre_challenge: true
method: challenge-loop
branch: cloudboard-7640
diff_hash: 11a7316858080409ccfd66ae107c940b2a7c9cd574750e6acef7d6c2c4f15d43
validation: failed (contention only; see below; the PR's CI is the full run of record)
subdir_audit: passed
timestamp: 2026-10-30T19:44:23Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 21 (1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 15 NITs; 1 WARNING answered with no change)
**Fixed:** 1 BLOCKER, 3 WARNINGs, 5 NITs | **Deferred / kept:** 1 WARNING answered, 7 NITs | **Asked (awaiting user):** 0

Reviewer findings files: ~/.cache/monalisa-review/review-7640-round{1,2,3,4}.md. The plan file carries the full
per-round ledger (.claude/plans/cloudboard-7640.md, "After review round N").

### Validation, stated as it happened

Five full validation runs on this machine (10-30, 13:18 to 14:41 CDT), each red only on timing under load (1-minute
load 21 to 58 on 12 cores), never on a file this branch changes. The branch changes only web/index.html, two browser
checks and five web.*.test.js files; it touches nothing under engine/.

- Run 3: engine/remote-typedallow-6590 and engine/remote failed; 263/263 alone.
- Run 4: died in a session restart (no result).
- Run 5 (HEAD a55d766be2): 25792 tests, 2 failed: engine/create.test.js (spawnSync ETIMEDOUT at 69 s) and
  engine/manipcheck-5683.test.js (a speed ratio, 557 ms vs 18 ms). Both files alone: 325/325 pass.
- Runs 1 and 2: the same shape (#1765 board-proof, cli.*, usage, rollover), each green alone.

A sixth local run would meet the same load. The PR's CI runs the full suite on a clean runner against the merge with
current main, and that run is the validation of record; the merge waits for it (and for the 0.7.76 merge hold).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] docs/browser-checks/render-createnav-2190.js - matched the refusal case-sensitively --> FIXED (f702902fb7)
- [WARNING] web/index.html - the waiting poll latched on ANY 403, so a signed-out local tab went dead --> FIXED (f702902fb7), keyed on kplusRemote
- [WARNING] same cause, the browser check measured one arm only --> FIXED (f702902fb7), both arms
- [NIT] name field refusal not a sentence --> FIXED; [NIT] check threw on an odd sentence --> FIXED; [NIT] poll label --> FIXED
- [NIT] named helper for the guarded asSentence expression --> DEFERRED (a lifted-function test would need its own guard anyway)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - a person at the computer on a non-loopback name no longer asks --> DEFERRED with reasoning: the route already refuses any non-loopback peer (server.js /api/remote/waiting), so nothing is lost; weakest premise (hosts-file alias) recorded in the plan
- [NIT] x3 (plan name, data-cloud-copy at load, sink-count pin) --> DEFERRED, reasons in the plan

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - the three API-key callouts still said "this computer" on a cloud machine --> FIXED (f20a104625), unit pin and browser arms
- [NIT] 403 comment, interval setup, import row refusal, comments naming rounds --> FIXED (f20a104625)
- [NIT] guarded expression matched byte for byte by three tests --> KEPT (iteration 1 deferral stands)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] kplusRemote guard at both scheduler and poll is belt and braces (no change)
- [NIT] asSentence answers '' where cloudWords answered undefined; no caller depends on it (no change)
- [NIT] plan name follows this repo's practice (no change)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | docs/browser-checks/render-createnav-2190.js | BRANCH | case-sensitive refusal match | FIXED | f702902fb7 |
| 2 | 1 | WARNING | web/index.html | BRANCH | poll latched on any 403 | FIXED | f702902fb7 |
| 3 | 1 | WARNING | docs/browser-checks/render-cloud-signin-4903.js | BRANCH | one arm measured | FIXED | f702902fb7 |
| 4 | 2 | WARNING | web/index.html | BRANCH | non-loopback name stops asking | DEFERRED | route already refuses it |
| 5 | 3 | WARNING | web/index.html | BRANCH | API-key callouts unwrapped | FIXED | f20a104625 |

### NITs (non-blocking, across all iterations)
- Named helper for the guarded asSentence expression (1, deferred); plan name, data-cloud-copy at load, sink-count pin (2, deferred);
  byte-for-byte expression match in three tests (3, kept); guard twice, '' vs undefined, plan name (4, no change)

### Strengths (across all iterations)
- Every behaviour test has a control that turns red without the change (the poll guard removed turns the remote test red)
- The browser check measures cloud and Mac arms of every sentence it changes
