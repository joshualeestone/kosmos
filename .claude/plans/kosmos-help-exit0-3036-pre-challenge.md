---
pre_challenge: true
method: challenge-loop
branch: kosmos-help-exit0-3036
diff_hash: a3bdd98c2fa7e203f28008a007c8e8c3214b90ff4515decfb52a47feb2282f1f
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T15:46:55Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 actionable (0 BLOCKERs, 2 WARNINGs, 1 CONVENTION) + 4 NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty at iteration 1 - the reviewer saw the branch's own work commit, not loop output)
- [WARNING] install/kosmos:1658 - the fix re-dispatched via raw `$0` (`( "$0" "$1" ) || true`), reintroducing a `$0`/PATH dependency the file's own top-of-script resolver deliberately avoids (symlinked ~/.local/bin/kosmos makes `$0` unreliable); and `|| true` would swallow a failed re-dispatch into a silent `exit 0` with no usage printed - worse than the bug. --> FIXED (commit 340108631): re-dispatch via `$SELF` (the symlink-resolved self-path the script already trusts for $NODE/$APP), capture the code with `|| _hrc=$?`, map ONLY the expected usage exit 2 to 0, and surface any other code.
- [WARNING] tools/test-kosmos-help-exit0-3036.sh - invoked the real install/kosmos without pinning KOSMOS_PORT to a dead port; the sibling cli.help-flag-1674.test.js pins KOSMOS_PORT=9 precisely so a regression cannot transmit a real message to a live board. --> FIXED (commit 340108631): `export KOSMOS_PORT=9`.
- [CONVENTION] commit f0f6c8fcd - subject did not follow the repo's `<branch> -- <message>` format. --> FIXED (amended to 340108631 with subject `kosmos-help-exit0-3036 -- kosmos <verb> --help exits 0, not 2 (kosmos#3036)`).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** the NITs cite the loop's own iteration-1 fix lines (install/kosmos:1664 the $SELF change), but NITs are not fixed and do not require the SELF-delete treatment; no actionable finding was self-generated
**Converged** - zero new BLOCKER/WARNING/CONVENTION. The reviewer independently verified all 8 message verbs exit exactly 2 on the bare missing-argument path (msg:908, reply:1009, post:1099, react:1423, report:1276, room:1538, feedback:1805, task:1831), so mapping only exit-2 to 0 masks no real failure; confirmed no infinite-recursion risk (the re-dispatch drops the help flag), that `$SELF` is in scope and the right choice, and that the test is red-capable with real controls and KOSMOS_PORT pinned. It also confirmed the branch is cleanly mergeable (the 4 upstream commits do not touch install/kosmos; the package.json bump to 0.6.64 does not conflict, git merge-tree clean).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos:1658 | BRANCH | raw $0 re-dispatch + `|| true` silent exit 0 | FIXED | 340108631 (use $SELF, surface non-usage codes) |
| 2 | 1 | WARNING | tools/test-kosmos-help-exit0-3036.sh | BRANCH | no dead-port KOSMOS_PORT pin | FIXED | 340108631 (export KOSMOS_PORT=9) |
| 3 | 1 | CONVENTION | (commit f0f6c8fcd) | BRANCH | commit subject not `<branch> -- <msg>` | FIXED | amended to 340108631 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] install/kosmos:1645 - the `-h` short form is handled by the same loop but the test exercises only `--help` (identical case arm; small coverage gap) (iteration 2)
- [NIT] install/kosmos:1664 - the `( "$SELF" "$1" )` subshell is redundant since $SELF is already a separate process (cosmetic) (iteration 2)
- [NIT] install/kosmos:1657 - the comment says "NOT raw $0" while the resolver derives SELF from BASH_SOURCE[0]; intent is correct, terminology slightly imprecise (iteration 2)
- [NIT] tools/test-kosmos-help-exit0-3036.sh:38 - the bare-verb control passes in both pre/post-fix states (a legitimate over-reach guard that cannot red on this fix; the plan already acknowledges this) (iteration 2)

### Strengths (across all iterations)
- Fix scope verified correct: all 8 affected cmd_* functions hit their usage-exit before any network call, so the re-dispatch is side-effect-free (iteration 1)
- Test controls are real, not vacuous: the bare-verb arms are the dangerous-answer control, the #1674 arm asserts absence of `Answered`; reverting reds ~9-10 of 19 assertions (iteration 1)
- Plan file states root cause, an explicit "Deliberately NOT changed" list, and a named weakest premise (iteration 1)
- The $SELF fix is correct and safe under `set -euo pipefail` (`|| _hrc=$?` suppresses errexit and captures the code); mapping only exit-2 to 0 masks no real failure (iteration 2)
- No infinite-recursion risk; $SELF is the right choice and honors the file's $0-avoidance convention; #1674 no-SEND guarantee holds (iteration 2)
- Test is genuinely red-capable, checks both exit code and usage text, pins KOSMOS_PORT=9 as real defense-in-depth, and is wired into test:shell as an actual run (iteration 2)
