---
pre_challenge: true
method: challenge-loop
branch: connlinux-5449
diff_hash: 0b39c6aaa7662c8d6c90f2164cf980cb49bf6ef1ff5300301faff607ef215ddb
validation: pending
subdir_audit: passed
timestamp: 2026-10-07T04:40:18Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind review)
**Converged:** Yes (2nd blind pass returned 0 BLOCKER/WARNING/CONVENTION)
**Total findings:** 2 BLOCKERs (fixed), 1 NIT (deferred)

> DRAFT PR. The challenge-loop review has CONVERGED, but the full node/web suite
> (6j validation) and the browser-checks render suite are QUEUED on a saturated box
> (~4-6h, per Liu Kang) and have NOT yet run green on this head. `validation: pending`
> is literal: this proof is written early, on Liu Kang's direction, so Sonya can
> review the code while the suite waits its turn. Do NOT merge until `validation` is
> `passed` and browser-checks are green; both will be run and posted before this leaves
> draft. Focused validation that DID pass on this head is listed under Strengths.

### Per-Iteration Breakdown

#### Iteration 1 (first blind review)
**Reviewer model:** default subagent model
**New findings:** 2 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [BLOCKER] docs/browser-checks/gated.txt - the new browser check was not in the runner's explicit run list (the runner uses gated.txt, not a glob), so it ran nowhere AND `tools.browser-checks-wired.test.js` would red on the orphan --> FIXED (commit 0b80093bd, added in sorted position)
- [BLOCKER] docs/browser-checks/README.md - the new check was not in the README index, so `browser-checks-indexed.test.js` would red --> FIXED (commit 0b80093bd, added a table row)
- [NIT] wording: the hatch summary "Have a shell on the server?" vs body "Open a terminal there" mix terms --> DEFERRED: cosmetic, reads fine, open to review.

#### Iteration 2 (second blind review)
**Reviewer model:** default subagent model
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (dup of the wording NIT)
**Self-generated:** 0
**Converged** - the reviewer confirmed onLinux mirrors onWindows, the three-way branch is correct and exhaustive (Linux matched before the Mac !onWindows arm, Mac/Windows byte-unchanged), #996 is upheld (the SSH imperative sits inside the closed details disclosure), the unit tests and browser check discriminate (Mac control, bidirectional leak control, canRunClaude:false gate), and the browser check is correctly wired (gated.txt sorted, README index, surface annotation matches).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | docs/browser-checks/gated.txt | BRANCH | new browser check not in the runner's run list | FIXED | 0b80093bd |
| 2 | 1 | BLOCKER | docs/browser-checks/README.md | BRANCH | new browser check not in the README index | FIXED | 0b80093bd |
| 3 | 1 | NIT | web/index.html | BRANCH | "shell" vs "terminal" wording mix | DEFERRED | cosmetic; open to review |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html - the Linux hatch summary says "Have a shell on the server?" while the body says "Open a terminal there"; both read fine (iterations 1-2).

### Strengths (across all iterations)
- onLinux() is an exact structural mirror of onWindows() (explicit-platform-wins, served-meta fallback, no page-scope const, no braces in strings), registered in PLATFORM_COPY_FNS.
- The three-way stuck-hatch branch is correct and exhaustive: Linux is matched before the Mac !onWindows arm it used to fall into; Mac and Windows copy are byte-unchanged.
- #996 upheld: the SSH/terminal imperative lives inside the closed <details> disclosure, and the canRunClaude gate is preserved so a box with no Claude on disk is not told to run a command that cannot run (#205).
- Non-vacuous tests: server.connect.test.js 61/61 (3 new Linux tests + a bidirectional leak control + the gate arm); the #996 guard web.terminal-hatch-996.test.js 3/3; the wired+indexed guards 12/12; the hermetic browser check render-connect-linux-stuck-5449.js 10/10 on chromium AND webkit (real summary area, closed disclosure, names SSH not a Terminal app, hatch gone when nothing to run).

### Remaining gates before this leaves draft / merges
- Full node/web suite green on this head (`unset KOSMOS_AGENT_TOKEN; bash tools/run-tests.sh`) - QUEUED.
- Browser-checks render suite green via the fair queue (`QUEUED_HEAVY_LIB=$HOME/work/agent-workforce bash tools/queued-heavy.sh ... bash tools/browser-checks.sh`) - to run AFTER the suite is green.
