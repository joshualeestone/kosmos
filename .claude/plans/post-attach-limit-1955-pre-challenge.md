---
pre_challenge: true
method: challenge-loop
branch: post-attach-limit-1955
diff_hash: 6851f42b96a05a7a2eb50a2bb802b712352fbb8cda86e5db9e84d85e750b9e81
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T06:15:23Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 WARNING, 4 NITs (plus STRENGTHs)
**Fixed:** 4 | **Accepted/documented residual:** 2

The fix (kosmos#1955 Done #2, the honest-limit half): `kosmos post` detects an attach attempt (`--file`/`--attach`, incl. `=` forms) BEFORE the network and says attachments are unsupported (paste inline), so an agent asked to post a document learns the limit instead of silently posting the literal flag as room text. The full attach capability (Done #1) is deferred as coupled to kosmos#1943.

### Per-Iteration Breakdown

#### Iteration 1 — 1 WARNING, 2 NITs (3 STRENGTHs)
- [WARNING] install/kosmos:629 — the comment claimed the guard covered "-f" but the case did not (I had dropped -f for false-positive reasons and left the comment) --> FIXED (aligned the comment to the code; "claim outlives the guard").
- [NIT] install/kosmos:626 — the loop scanned "$@" AFTER `project` was consumed, so a project-omitted `post --file x` slipped past --> FIXED (moved the loop above the project-consume, scanning original args; added a test arm).
- [NIT] install/kosmos:636 — a standalone --file/--attach in unquoted prose is refused; `--` not honored --> ACCEPTED (safe direction; documented as a deliberate tradeoff).
- STRENGTHs: detection runs before healthy()/curl (cannot post the literal flag); the test control is load-bearing; scope deferral sound + forward-compatible.

#### Iteration 2 — 2 NITs (4 STRENGTHs)
**Converged** — zero new actionable. An independent reviewer confirmed the guard placement (before project-consume and the network), the non-vacuous two-directional test with a dead-port pin, bash-3.2/set -e correctness, and comment/code alignment, and could construct no recognized attach form that slips through.
- [NIT] the comment's "which multi-word messages already are [quoted]" was optimistic --> FIXED (a message is one arg only if quoted).
- [NIT] the bare-path / `@file` residual (indistinguishable from text, out of scope) --> put on record in the comment.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | install/kosmos:629 | comment claimed -f coverage the code lacked | FIXED |
| 2 | 1 | NIT | install/kosmos:626 | project-omitted attach slipped past | FIXED (scan original args) |
| 3 | 1 | NIT | install/kosmos:636 | standalone --file in unquoted prose refused | ACCEPTED (documented) |
| 4 | 2 | NIT | install/kosmos | "already quoted" comment optimistic | FIXED |
| 5 | 2 | NIT | install/kosmos | bare-path residual | DOCUMENTED |

### Strengths
- The detection runs BEFORE `project="${1:-}"` and before `healthy()`/`curl`, scanning the ORIGINAL args, so no attach attempt (project-omitted included) can reach the network and post the literal flag as room text.
- cli.post-attach-1955.test.js: 5 arms, load-bearing control (a plain text post is NOT intercepted AND reaches the send path), a dead-port pin (KOSMOS_PORT=9) so it can never post to a live board, and both-direction assertions on every arm.
- Deferring the full attach capability (Done #1) to a design with kosmos#1943 is reasonable and the honest-limit is forward-compatible (the message names the tracking issue; nothing has to be unwound when the real capability lands).

### Scope note
This delivers the card's Done #2 (honest limit) + Done #3 (a test that the request produces a clear signal). Done #1 (an agent CAN attach a file) is a larger CLI+server+storage+room change coupled to kosmos#1943 (there is no agreed destination for a document an agent produces), left to a deliberate design of the two together. #1955 stays OPEN for it.
