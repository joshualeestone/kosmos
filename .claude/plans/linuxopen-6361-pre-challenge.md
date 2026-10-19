---
pre_challenge: true
method: challenge-loop
branch: linuxopen-6361
diff_hash: 1dc8ee17f9bda559288cb89151f63793bed4aee066e55306006f3c449a01faf8
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T18:36:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind reviews, alternating opus and sonnet, on the branch rebased onto main after #6394
**Converged:** Yes (iteration 7, opus: its one WARNING repeated the plan's xdg-open-blocking premise)
**Total findings:** 13 actionable (0 BLOCKERs, 13 WARNINGs), about 30 NITs
**Fixed:** 9 | **Deferred:** 4 (plus duplicates of deferred entries) | **Asked (awaiting user):** 0

Validation: the full suite PASSED on Mortals at 8044ada418 (hash 1dc8ee17f9bd). The related test files pass locally
(cli.open-linux-6361 13, cli.open-1957, cli.board-proof-1765, cli.exit-code-mapping-3628: 40/40). Origin: every
finding recorded BRANCH (the blame lookup was not run mechanically). Not UI: CLI text only.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 6 NITs
- [WARNING] the no-terminal line sent a person to a plain page with no way to sign in --> FIXED (c8e2427d)
- [WARNING] the bare `kosmos` is not always on PATH --> FIXED (c8e2427d): the full-path command
- [WARNING] an agent at a terminal would get the one-time address in its transcript --> FIXED (c8e2427d): `_invoked_by_agent`, with a CONTROL arm

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 NITs
- [WARNING] an agent with no supervisor markers --> DEFERRED: the plan's weakest premise
- [WARNING] platforms other than Darwin and Linux now get no opener --> DEFERRED: before, they failed on a missing /usr/bin/open
- [WARNING] a dead DISPLAY left the person with the plain address --> FIXED (e59a9a16): a failed opener takes the no-opener path, still exit non-zero (#1957)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 5 NITs
- [WARNING] the shared failure path changes macOS, untested --> FIXED (04eb65c2): an arm, and the plan says so
- [WARNING] Wayland-only and other-platform arms missing --> FIXED (04eb65c2)
- [WARNING] a source-only test named as behaviour --> FIXED (04eb65c2): renamed

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs (one a duplicate of the plan's macOS trade), 3 NITs
- [WARNING] a failed opener on a non-enforcing board said the failure twice --> FIXED (1a77f124)
- [WARNING] a recorded terminal keeps the address --> FIXED (1a77f124): named in the plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 6 NITs
- [WARNING] an enforcing board that answered without a nonce, with no opener, got a dead-end plain address and exit 0 --> FIXED (a26ed131): exit 1 and a retry command, with a CONTROL arm
- [WARNING] a failed opener may have spent the address --> FIXED (a26ed131): "if no browser opened"

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
- [WARNING] the opener path still opens a no-nonce plain page --> DEFERRED: #1979's own fallback, pinned by its mint-500 test (plan, 8044ada4)
- [WARNING] xdg-open can exit 0 without opening, or block --> DEFERRED: the plan's weakest premise

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 new (1 WARNING, a duplicate of the xdg-open premise), 4 NITs
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos cmd_open | BRANCH | dead-end "sign in there" | FIXED | c8e2427d |
| 2 | 1 | WARNING | install/kosmos cmd_open | BRANCH | bare command not on PATH | FIXED | c8e2427d |
| 3 | 1 | WARNING | install/kosmos cmd_open | BRANCH | agent gets the address | FIXED | c8e2427d |
| 4 | 2 | WARNING | install/kosmos cmd_open | BRANCH | unmarked agent | DEFERRED | plan premise |
| 5 | 2 | WARNING | install/kosmos cmd_open | BRANCH | other platforms | DEFERRED | better than before |
| 6 | 2 | WARNING | install/kosmos cmd_open | BRANCH | dead DISPLAY | FIXED | e59a9a16 |
| 7 | 3 | WARNING | cli.open-linux-6361.test.js | BRANCH | macOS failure untested | FIXED | 04eb65c2 |
| 8 | 3 | WARNING | cli.open-linux-6361.test.js | BRANCH | Wayland / other-platform arms | FIXED | 04eb65c2 |
| 9 | 3 | WARNING | cli.open-linux-6361.test.js | BRANCH | source-only test name | FIXED | 04eb65c2 |
| 10 | 4 | WARNING | install/kosmos cmd_open | BRANCH | failure said twice | FIXED | 1a77f124 |
| 11 | 5 | WARNING | install/kosmos cmd_open | BRANCH | no-nonce dead end | FIXED | a26ed131 |
| 12 | 6 | WARNING | install/kosmos cmd_open | BRANCH | opener path no-nonce | DEFERRED | #1979's fallback |
| 13 | 6 | WARNING | install/kosmos cmd_open | BRANCH | xdg-open exit 0 / blocking | DEFERRED | plan premise |

### Strengths
- The #1765 proof and nonce refusals still run first; a test pins that a failed proof is neither opened nor printed.
- The one-time address goes only to a person's terminal; every failure ends non-zero on stderr (#1957 kept).
