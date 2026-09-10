---
pre_challenge: true
method: challenge-loop
branch: openai-firstrun-sub-2621
diff_hash: e5cb045520abf8b7f7236991b2d7609e9c53528e92840277e9f96e097a424f3f
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T12:41:04Z
iterations: 5
converged: true
---

> **Re-hashed after a MECHANICAL merge of origin/main (2026-09-10 ~07:45).** main had
> advanced past this branch's base; the merge conflicts were only reconciliations of
> shared-file bookkeeping — `browser-checks-reason-grep.test.js` emit-site counts
> (80/49 + main's additions -> 88/56, verified by the test), the `tools/browser-checks.sh`
> runner list (both sides' new checks kept), and `web.provider-collapse.test.js` /
> README (auto-merged). `web/index.html` auto-merged with the feature code UNCHANGED
> (frOpenaiSubAbort / frOpenaiShowPick / the picker+sub-step all intact, no markers).
> The 5-iteration blind review below therefore still describes the delivered feature
> code as-shipped; only the diff_hash is updated to match the merged diff.

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (converged at iteration 5 with zero new actionable findings)
**Converged:** Yes
**Total findings:** 3 BLOCKER, 2 WARNING, 2 CONVENTION, 8 NIT (across all iterations)
**Fixed:** all BLOCKER/WARNING/CONVENTION | **Deferred/noted:** the residual NITs

The loop earned its keep: iterations 2 and 4 (both Sonnet) each found a real, reachable
bug that the Opus passes had not, exactly the multi-model value kosmos#2032 describes.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (general-purpose)
**New findings:** 0 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NIT
**Self-generated:** 0
- [WARNING] web/index.html — HTML comment falsely claimed the driver was "shared via els config"; it is mirrored --> FIXED (corrected the comment)
- [CONVENTION] plan divergence (plan said generalize, impl mirrors) --> FIXED (reconciled the plan)
- [NIT] dead frOpenaiShowKey --> FIXED (removed); [NIT] shared-state invariant undocumented --> FIXED (documented)
- also fixed the #2518 surface trailers here.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 1 NIT
**Self-generated:** 0
- [WARNING] web/index.html:40592 (frOpenaiSubWatch) — no step-scoped teardown: a sign-in started on step 5 then navigated-away-without-cancel kept polling and could paint into a hidden pane --> FIXED (FR_STEP!==5 guard at the tick top AND before the connected paint, mirroring Claude's frConnWatch; a red-on-pre-guard teardown test arm added)
- [NIT] frOpenaiSubConnected's unused account param --> FIXED (documented + renamed _account)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, 3 NIT
**Self-generated:** 0
- [CONVENTION] web/index.html:8758 — Connect button's aria-controls named the key form, but it now reveals the picker first --> FIXED (aria-controls="fr-openai-confirm fr-openai-pick")
- [NIT] picker/sub-step lacked role="group"+aria-labelledby --> FIXED; [NIT] picker-re-entry poll survival undocumented --> FIXED (note); [NIT] teardown arm used a non-contract state --> FIXED (awaiting-browser)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [BLOCKER] web/index.html:40409 (frCollapseProviders) — did not hide the new fr-openai-pick/sub-step or stop the poll on provider switch, so opening Claude left the OpenAI panel open with the poll running (regression vs Settings' acctPick) --> FIXED
- [WARNING] web/index.html:40563 (frOpenaiChoose) — did not abort a running sign-in on branch switch, so a late connect could clobber the key form --> FIXED
- Both fixed via a shared frOpenaiSubAbort() (stop poll + clear session + reset) wired into frCollapseProviders (+ the two ids in its hide list), frOpenaiChoose, and the step-guard. Two new non-vacuous browser-check abandon arms (branch-switch, provider-switch) that red on pre-fix.
- [CONVENTION] plan's stale weakest-premise --> FIXED (rewritten to the real premise: teardown on every abandon path)
- [NIT] step-guard lacked frOpenaiSubReset --> FIXED (folded into frOpenaiSubAbort)
- 6g then caught that the frCollapseProviders change broke web.provider-collapse.test.js (isolated-vm ReferenceError) --> FIXED (injected the abort stub + the two panel els; added coverage that collapse hides picker/sub-step and aborts, and does NOT abort when nothing was open).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT
**Self-generated:** 0
**Converged** — no new actionable findings. 4 STRENGTHs confirmed: abandon/leak coverage is complete and matched to the tests; the rename is clean with no dead code; Settings regression risk is genuinely zero (no executable acct-openai* line changed); the browser check is non-vacuous.

### Final Ledger (actionable findings)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:~8805 | BRANCH | false "shared driver" comment | FIXED | b09e0ee4 |
| 2 | 1 | CONVENTION | plan | BRANCH | generalize-vs-mirror plan divergence | FIXED | b09e0ee4 |
| 3 | 2 | WARNING | web/index.html:40592 | BRANCH | leaked poll / paint into hidden pane | FIXED | 08a9e6e7 |
| 4 | 3 | CONVENTION | web/index.html:8758 | BRANCH | stale aria-controls | FIXED | 298642a4 |
| 5 | 4 | BLOCKER | web/index.html:40409 | BRANCH | frCollapseProviders misses new panels + no abort | FIXED | 40a738a4 |
| 6 | 4 | WARNING | web/index.html:40563 | BRANCH | frOpenaiChoose no abort on branch switch | FIXED | 40a738a4 |
| 7 | 4 | CONVENTION | plan | BRANCH | stale weakest-premise | FIXED | 40a738a4 |
| 8 | 4 | BLOCKER(6g) | web.provider-collapse.test.js | BRANCH | test broke on the frCollapseProviders change | FIXED | d4ae92fd |

### NITs (non-blocking, for consideration)
- needsRunner reroute omitted in the first-run sub-go (unreachable in practice — picker only shows once the runner is present; degrades gracefully). Flagged iter1 + iter5.
- frOpenaiSubConnected(justAdded) leaves stale text in the hidden #fr-openai-key field (hidden, never submitted; matches the key path).
- pick-sub/pick-key buttons carry no aria-controls (consistent with the Settings mirror).

### Strengths
- Model variation earned two real bugs (iters 2 + 4) the same-model passes missed.
- Settings sign-in flow verifiably untouched; the mirror shares only pure/teardown/session/engine.
- Abandonment fully covered (three paths) with non-vacuous, red-on-pre-fix browser-check arms.
