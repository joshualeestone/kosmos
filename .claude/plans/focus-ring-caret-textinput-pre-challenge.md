---
pre_challenge: true
method: challenge-loop
branch: focus-ring-caret-textinput
diff_hash: bd42447aa718f1ecc1d0055fd19515008921d83109f5282538a4f299ff7be3ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T04:20:40Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 7 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 5 NITs)
**Fixed:** 3 | **Deferred:** 3 | **Convention (process, satisfied at PR):** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] docs/browser-checks/render-composer-reset.js — asserted box-shadow === 'none' (forbidding ALL box-shadow), contradicting the JSDOM test's deliberate allowance for a future soft non-dark focus treatment --> FIXED (da8fe510): now forbids the near-black '74, 79, 87' ring substring specifically, so 'none' and a soft non-near-black halo both pass, the #1303 D dark ring fails. The two layers now agree.
- [CONVENTION] .claude/plans — Angel's CLAUDE.md requires a screenshot in the PR + Discord for a frontend change --> SATISFIED at PR time: before/after screenshots of the focused composer (ring gone) attached to the PR and posted in the channel.
- [NIT] web.focus-ring-1303d.test.js — source-string guards keyed to exact tokens/spacing; a dark re-add in a different near-black token could evade the JSDOM layer --> DEFERRED: keying on the specific #1303 D near-black value is the documented intent; the computed-style browser-check is the behavioral backstop (added a note in iter 2 that the layers are complementary).
- [NIT] browser-check border check keyed to the one near-black value --> DEFERRED: same reasoning; the intent is to catch Josh's specific dark stroke returning, not to forbid every future focus treatment.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings; the fresh agent independently confirmed the a11y scope, the two-layer consistency, and the honest #1303 D reversal documentation.
- [NIT] render-composer-reset.js — `focusStyle.boxShadow.indexOf` could throw in the dead noBox branch --> FIXED (61efad9a): guarded with `typeof ... === 'string'` for symmetry with the null-safe siblings.
- [NIT] web.focus-ring-1303d.test.js — worth a note that the source guards and the browser-check are complementary --> FIXED (61efad9a): added the note.
- [NIT] render-composer-reset.js — only #pj-post is asserted, though the rule was shared by all composers --> DEFERRED: `.composerbox:focus-within` is ONE global CSS rule; asserting one composer instance proves its removal for every instance.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | render-composer-reset.js | box-shadow===none over-constrained vs JSDOM intent | FIXED | da8fe510 |
| 2 | 1 | CONVENTION | plan | screenshot required in PR + Discord | SATISFIED | attached at PR |
| 3 | 1 | NIT | focus-ring test | source-regex exact-token guards | DEFERRED | intent-keyed; browser-check backstop |
| 4 | 1 | NIT | render-composer-reset.js | border check keyed to one near-black value | DEFERRED | same intent |
| 5 | 2 | NIT | render-composer-reset.js | boxShadow.indexOf throw on dead branch | FIXED | 61efad9a |
| 6 | 2 | NIT | focus-ring test | note the layers are complementary | FIXED | 61efad9a |
| 7 | 2 | NIT | render-composer-reset.js | only #pj-post asserted | DEFERRED | one global CSS rule |

### Outstanding questions (ASKED)
- None.

### NITs (non-blocking)
- Source-regex guards are token/spacing-sensitive (deferred; browser-check is the backstop).
- Only one composer instance is asserted (deferred; one global CSS rule).

### Strengths (across iterations)
- Accessibility scope is verifiably correct: removing `.composerbox:focus-within` stranded no keyboard-focusable control; `.tsearch:focus-within` and `.orgmap .onode:focus-within` keep their rings, and the composer's own buttons (`.attachbtn`/`.emojibtn` :focus-visible, the Post button's UA ring) keep theirs. Every `.composerbox` instance holds a `.cinput` with a visible caret.
- WCAG reasoning is sound and honest: 2.4.7 Focus Visible (AA) is satisfied by the text caret; 2.4.13 Focus Appearance (AAA) is the one a thin caret misses, a documented tradeoff below the AA floor. The plan names its weakest premise and what would reverse the decision.
- Both test layers can return the dangerous answer (they fail if the near-black ring/border returns) and are consistent with each other, each forbidding only the near-black treatment while leaving room for a future soft one.
- The #1303 D "SOFTENED, NOT DELETED" reversal is documented transparently in the CSS comment, the test header, and the plan. No em dashes in any changed file.
