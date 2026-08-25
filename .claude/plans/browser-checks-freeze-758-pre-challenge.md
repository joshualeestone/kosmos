---
pre_challenge: true
method: challenge-loop
branch: browser-checks-freeze-758
diff_hash: 48cd8e823ac7d59db5c5927eeb3563b028f5e0668cbfe6a19d2410127e18cfb3
subdir_audit: passed
timestamp: 2026-08-25T07:14:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (round 2 found no BLOCKER; a trivial CONVENTION fixed, two narrow WARNINGs documented and deferred)
**Total findings:** 1 BLOCKER, 1 CONVENTION (both fixed); 3 WARNING, 1 NIT (deferred, documented)
**Fixed:** 2 | **Deferred:** 4

### Per-Iteration Breakdown

#### Round 1
**New findings:** 1 BLOCKER, 3 WARNING
- [BLOCKER] `tools/browser-checks.sh` — `trap cleanup EXIT` was registered AFTER the Playwright-resolution block, which can `exit 0` (the documented `KOSMOS_SKIP_BROWSER_CHECKS=1` opt-out, a normal CI/release-machine case) or `exit 2` (no Playwright found) BEFORE the trap that would thaw a freeze ever ran. Leaked a phantom `.git/worktrees` entry and a temp dir on every such invocation. --> FIXED (d1f8ea9): moved the whole cleanup/RUN_DIR/trap block to immediately after the freeze block, before anything that can exit early. Reproduced BOTH ways: forced the exact leak scenario against the fixed script (clean, no leak) and against the unfixed script run in place at the prior commit (leaked both a worktree registration and a temp dir, confirming the control).
- [WARNING] detached HEAD is release.sh's freeze in practice but not unique to it (mid-rebase/bisect/manual checkout also detaches) --> documented in-code (d1f8ea9), not fixed: narrow, only fires on a deliberately unusual local git state.
- [WARNING] the uncommitted-changes warning is a real workflow-friction cost (a direct run against uncommitted edits now needs a throwaway commit to be reflected) --> accepted as the disclosed, intended tradeoff (plan file's own "Finished when": loud, not silent, about this exact change).
- [WARNING] nested-worktree question (freezing from a worktree of a worktree) --> not independently verified by the reviewer (out of scope for a read-only review), but the orchestrator's own reproduction ran end-to-end from exactly this nested setup (`~/work/agent-workforce-browser-checks-freeze-758` is itself a worktree of `~/work/agent-workforce`) and worked.

#### Round 2
**New findings:** 1 CONVENTION, 1 WARNING (narrow, newly named), 1 NIT
- [CONVENTION] the `shellcheck source=` directive pointed at `tools/lib/release-freeze.sh`, which shellcheck resolves relative to the referring script's own directory (`tools/`), landing on the nonexistent `tools/tools/lib/release-freeze.sh` --> FIXED (1951799): corrected to `lib/release-freeze.sh`. No runtime effect (lint hint only, no shellcheck step wired into this repo), but wrong on its own terms.
- [WARNING] a Ctrl-C landing in the few lines between `release_freeze` succeeding and `trap cleanup EXIT` being registered could still leak a worktree -- structurally the same class round 1 fixed, narrowed from the whole Playwright block to single-digit lines --> DEFERRED: this file traps no signal anywhere else (no existing `INT`/`TERM` convention to extend), and the reviewer's own assessment was "likely accepted as out of scope."
- [NIT] `cd "$REPO"` at line 71 is unchecked under `set -uo pipefail` (no `-e`) --> DEFERRED: pre-existing pattern (the original `cd "$REPO"` at line 40 has the same property), not introduced by this diff.
- Re-confirmed unchanged from round 1 (not a new finding): the detached-HEAD narrow limitation.

**Converged** — round 2 traced every `exit`/`return` in the file and confirmed round 1's fix is structurally complete for all explicit exit paths; the remaining findings are either trivial (fixed) or narrow and consistent with the file's existing conventions (deferred, documented).

### The reproductions (all performed directly, not simulated)

1. **Isolation holds under a real race** (pre-existing from round 1, re-verified unaffected by round 2's changes): booted a real board via the freeze; confirmed via `lsof` that the server process's `cwd` is the frozen temp worktree, not the source checkout; touched a file in the SOURCE checkout mid-run; confirmed `/api/status`'s `engine.staleSince` stayed `null` throughout.
2. **The leak bug, reproduced and then fixed** (round 1): forced the `KOSMOS_PW_NODE_PATH=/nonexistent... KOSMOS_SKIP_BROWSER_CHECKS=1` early-exit path. Pre-fix (running the prior commit's script in place): leaked both a `git worktree` registration and a temp dir. Post-fix: neither leaked, confirmed twice from a clean baseline.
3. **Full end-to-end runs, twice**, with real Playwright: the entire `tools/browser-checks.sh` suite (regress-a-night through render-thread, ~30 checks) both times ended "all page checks passed", with zero leaked worktrees or temp dirs afterward in either run.
4. **The release.sh path confirmed inert**: read `tools/release.sh`'s own freeze-then-invoke sequence (`REPO="$BUILD"` at line 134, `cd "$REPO" && bash tools/browser-checks.sh` at line 168) to confirm this script's own `REPO="$(cd "$(dirname "$0")/.." && pwd)"` resolves to the already-frozen tree during a real release cut, so the detached-HEAD branch (skip freezing) is taken there — no double freeze, no added time on the time-pressured cut path.

### Final Ledger

| # | Round | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/browser-checks.sh | trap registered after early-exit paths, leaking the freeze | FIXED | d1f8ea9 |
| 2 | 1 | WARNING | tools/browser-checks.sh | detached-HEAD not unique to release.sh | DOCUMENTED, deferred | d1f8ea9 (comment) |
| 3 | 2 | CONVENTION | tools/browser-checks.sh:66 | wrong shellcheck source= path | FIXED | 1951799 |
| 4 | 2 | WARNING | tools/browser-checks.sh | Ctrl-C window before trap registration | DEFERRED | narrow, no existing signal-trap convention to extend |

### Strengths (across both rounds)
- Round 1's fix was independently re-traced in round 2 by walking every `exit`/`return` in the file and confirmed structurally complete, not just relocated to fix the one reported symptom.
- The freeze/thaw variable visibility (no subshell scoping issues) was verified by reading the actual assignment forms, not assumed from bash's general reputation for this.
- Every claim in the plan file about reproductions performed was independently checked against the actual diff and found accurate (round 1), and re-confirmed against the final diff (round 2).
