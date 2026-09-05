---
pre_challenge: true
method: challenge-loop
branch: wizard-enter-2186
diff_hash: 11939174df41e64fd8734a69ff8f695fcdc3f2bd4b038f3689ca55cddb672f86
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T04:02:36Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (3 pre-rebase + 1 post-rebase re-review)
**Converged:** Yes
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 3 NITs) — all fixed
**Fixed:** 3 code fixes + 3 NIT polish | **Deferred:** 0 | **Asked:** 0

Card: kosmos#2186 — Install steps: Enter/Return triggers Continue when the step
is valid. Change: a named wizard-wide `frEnterSubmit` keydown handler on
`#firstrun` that activates whatever `#fr-next` currently is, mirroring its
enabled state, with per-field carve-outs.

### Per-Iteration Breakdown

#### Iteration 1 (pre-rebase)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
- [CONVENTION] docs/browser-checks/render-firstrun-enter-2186.js — comment said "POST /api/you", the request (and assertion) is PUT --> FIXED
- [NIT] web/index.html frEnterSubmit — preventDefault-without-stopPropagation asymmetry with fr-openai-key --> documented inline

#### Iteration 2 (pre-rebase)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
- [WARNING] web/index.html #fr-foundsearch — the "Your agents" ending shows Continue enabled AND a live search box (type=search); Enter there bubbled to frEnterSubmit and fired frFinish, ejecting the person mid-adoption --> FIXED: carve out type=search (scoped, not blanket INPUT) + unit arms
- [CONVENTION] web/index.html #fr-conn-code — own Enter gesture lacked stopPropagation, unlike fr-openai-key --> FIXED: added it for parity/defense-in-depth

#### Iteration 3 (pre-rebase)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both addressed)
- [NIT] web.firstrun-enter-2186.test.js — A and SELECT carve-outs unpinned --> added arms
- [NIT] web/index.html — note the tz SELECT is intentionally inert on Enter --> added comment
**Converged** — no new actionable findings.

#### Iteration 4 (post-rebase re-review)
The branch was rebased onto origin/main, which had advanced 4 commits including
#2196 (gate first-run Continue on a real Accessibility check). One conflict
(`tools/browser-checks.sh` run-loop — both sides appended a check name) resolved
by keeping both (render-a11y-gate-2125 + render-firstrun-enter-2186). A fresh
blind review of the rebased tree returned **0 findings** and independently
verified the a11y-gate composition: `frEnterSubmit`'s `disabled ||
aria-disabled==='true'` check mirrors `frPollA11y`'s gating (it sets both), so
Enter no-ops exactly when the a11y check greys Continue. No code change this
iteration. **Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | docs/browser-checks/render-firstrun-enter-2186.js | comment said POST, request is PUT | FIXED | pre-rebase |
| 2 | 1 | NIT | web/index.html frEnterSubmit | preventDefault-not-stopPropagation asymmetry | FIXED (comment) | pre-rebase |
| 3 | 2 | WARNING | web/index.html #fr-foundsearch | Enter in the live search box ejected the user via frFinish | FIXED | pre-rebase |
| 4 | 2 | CONVENTION | web/index.html #fr-conn-code | own Enter gesture lacked stopPropagation | FIXED | pre-rebase |
| 5 | 3 | NIT | web.firstrun-enter-2186.test.js | A/SELECT carve-outs unpinned | FIXED | pre-rebase |
| 6 | 3 | NIT | web/index.html | note tz SELECT intentionally inert | FIXED | pre-rebase |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking)
All three NITs were addressed rather than deferred.

### Strengths
- Double-submit prevention verified end-to-end (fr-openai-key + fr-conn-code stopPropagation; BUTTON/A/SELECT native; e.repeat; IME; synchronous About-you disable).
- Every wizard field with its own Enter semantics is covered, including the a11y-gated Continue (composition verified in iteration 4).
- Both test layers discriminate: unit test lifts and RUNS the real frEnterSubmit (16 arms + CONTROL); browser check drives a real keydown, uses the gated About-you step for an empty-vs-filled contrast, observes the real PUT /api/you, perturbation-verified to red without the handler.

### Validation
Full `yarn`/npm test sequence green on the rebased HEAD (node --test: 4501 pass / 0 fail), guard test green (no contention flake), plus the new browser check run headless on the rebased base (a11y-gate present) and perturbation-verified. `diff_hash` computed against origin/main.
