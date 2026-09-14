---
pre_challenge: true
method: challenge-loop
branch: bc-ci-allowlist-b9-835
diff_hash: a58abfc417b2e3d5b182203a7691a323d8d63bb752c6da1df53b37b783e36daa
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T09:42:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 3 WARNINGs (2 -> DROPPED checks, 1 -> NIT-level count) + NITs
**Fixed/resolved:** 3 | **Deferred:** 0 | **Asked:** 0
**Net change:** started as 3 candidates, DROPPED 2, ships 1 (render-worlds-switcher-1704).

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a. Node suite green; validation clean first attempt (the later reds were flakes, see below).

#### Iteration 2 (first blind reviewer, sonnet)
- [WARNING] render-model-restart-interstitial reads live canvas pixels (getContext getImageData) to
  assert a rAF animation (emulateMedia reducedMotion), + 12 sleep() calls = animation/paint class.
  --> DROPPED. My fragile-signal grep missed it (rAF in web/index.html, getImageData + custom sleep()
  not in the grep).

#### Iteration 3 (second blind reviewer, opus)
- [WARNING] render-firstrun-openai-sub-2621 settles an async poll with FIXED sleeps only
  (waitForTimeout 2100 over a 1200ms poll, no condition waits) - intermittent-red risk on a starved
  runner, degrades the always-run subset's reliability. --> DROPPED (headless-safe but not
  reliability-safe for the always-run allowlist; a future event-driven version is a clean re-add).

#### Iteration 4 (third blind reviewer, sonnet)
**New findings:** 0 BLOCKERs/WARNINGs/CONVENTIONs, 1 NIT.
- [NIT] plan said "~8 event-driven waits" for worlds-switcher; actual 10 (4 waitForSelector + 6
  waitForFunction), erring safe. --> corrected in the plan (no CI-red risk). Reviewer re-verified
  worlds-switcher fully clean (no canvas/geometry/color/screenshot; DOM/text/visibility only),
  mutation-safe (in-process server.js against mkdtemp roots + fake-tmux, random port), and both
  dropped checks correctly absent from the allowlist.
**Converged** — no actionable findings.

#### Closing validation
6g on the converged HEAD first hit the known `codex-report-bridge` #1139 timeout flake (10.9s under
load; node suite 6071/6071 otherwise; confirmed green-alone 9/9 in a prior batch). Re-ran: clean,
node 6072/6072, recorded clean for the shipping HEAD.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | render-model-restart-interstitial | BRANCH | canvas-pixel rAF animation assertion + 12 sleeps | RESOLVED | DROPPED from batch |
| 2 | 3 | WARNING | render-firstrun-openai-sub-2621 | BRANCH | fixed-sleep-only poll, intermittent-red risk in always-run subset | RESOLVED | DROPPED from batch |
| 3 | 4 | NIT->plan | plan condition-wait count | BRANCH | "~8" should be 10 (errs safe) | FIXED | 12e41ae9 |

### Outstanding questions (ASKED)
None.

### Strengths
- The loop protected the allowlist's purpose: two candidates that would have added animation-paint
  and fixed-sleep flake surface to the always-run per-PR subset were caught by blind review and
  dropped, leaving one solidly-robust check. (iterations 2, 3, 4)
- render-worlds-switcher-1704 is headless-robust (DOM/text/visibility, no canvas/geometry/color),
  uses 10 event-driven condition waits (robust to runner load) + only 2 fixed settles, and is
  mutation-safe (in-process server.js against throwaway mkdtemp roots + fake-tmux). (iteration 4)
- Self-validating: this PR's own browser-checks CI runs the expanded allowlist; the never-ran guard
  hard-reds a missing name; a wrong pick reds the PR before merge. (all iterations)
