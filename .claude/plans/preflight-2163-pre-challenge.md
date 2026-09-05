---
pre_challenge: true
method: challenge-loop
branch: preflight-2163
diff_hash: 5ae3b0d6d5c25e22d1453da1b5111c1b6f4c1d2029d2147d2d1a9b647d661a99
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T01:48:23Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (this run) — a post-rebase re-verification. The branch previously
converged over 3 iterations before it was rebased onto origin/main to catch up 7
commits and resolve one trivial `tools/browser-checks.sh` check-list-line conflict
(union of two appended check names). The rebase changed the diff base and therefore
the diff_hash, so a fresh proof was required; the feature logic is byte-identical to
the earlier converged state.
**Converged:** Yes — the fresh blind reviewer found zero NEW BLOCKER/WARNING/CONVENTION.
**Total findings:** 8 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, 6 STRENGTHs)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no actionable findings. The reviewer independently enumerated every
first-run browser check and confirmed only the two fixed-click walks from the Success
screen (`click-first-run.js`, `render-sleep-button.js`) needed the +1 bump; all other
first-run checks deep-link via `?fr-step=N`, drive `frGo(step)` directly, or use the
content-based `advanceToAboutYou` walk, so none lands a step short from the inserted
interstitial. The reviewer also verified `paneCount`'s `/^fr-pane-\d+$/` regex keeps
the count at 7 (excluding `fr-pane-intro`), that `render-preflight-2163.js` reds against
the pre-#2163 flow (a real discriminator, not a tautology), that `frShowExplainer`
focuses `#fr-title` for WCAG 4.1.3, and that there are no em dashes in the diff.

- [NIT] web/index.html:34161 — `frShowExplainer()` does not call `frDots.progress(...)`. --> DEFERRED: by design. The function empties `fr-segs`, so the interstitial shows no progress dots, exactly like the Success screen it mirrors (the interstitial is conceptually outside the numbered count). Consciously confirmed, not accidental.
- [NIT] web/index.html:7830 — Placement is after the Success screen, not literally first. --> DEFERRED: the documented design decision. Success is the scope-locked, Josh-ruled install-confirmation surface; no macOS permission prompt fires before the numbered steps, so the interstitial still precedes the entire permission gauntlet it warns about. Reversible copy positioning; recorded in the plan file.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | web/index.html:34161 | frShowExplainer omits frDots.progress | DEFERRED | By design: interstitial shows no dots, mirrors Success |
| 2 | 1 | NIT | web/index.html:7830 | Interstitial sits after Success, not first | DEFERRED | Documented design: Success is scope-locked, gauntlet still follows |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:34161 — frShowExplainer omits frDots.progress (iteration 1) — deferred by design
- [NIT] web/index.html:7830 — interstitial placement after Success (iteration 1) — deferred, documented in plan

### Strengths (across all iterations)
- The core design keeps the interstitial (class `fr-pane`, non-numeric id `fr-pane-intro`) OUTSIDE the numbered count: FR_STEPS stays 7, segments stay 6, no off-by-one in "Step N of M" (iteration 1)
- `lib-firstrun-steps.js` paneCount regex `/^fr-pane-\d+$/` excludes only the interstitial, preserving the `segments == panes-1` cross-check (iteration 1)
- Every first-run browser check enumerated; only the two fixed-click walks from Success needed the +1 bump, and both got it; all others deep-link or content-walk and are unaffected (iteration 1)
- `render-preflight-2163.js` is a real discriminator: it times out and reds on the pre-#2163 flow, not a tautology (iteration 1)
- Accessibility handled: `frShowExplainer` focuses `#fr-title` (tabindex=-1) per WCAG 4.1.3, and the new check asserts it (iteration 1)
- No em dashes anywhere in the diff, verified byte-level; plan file present and matches the implementation (iteration 1)
