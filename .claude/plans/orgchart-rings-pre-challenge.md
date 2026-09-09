---
pre_challenge: true
method: challenge-loop
branch: orgchart-rings
diff_hash: a90887f8d878b116ce1af4cf439654402ade028ab97005a9565ceda805bd6615
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T16:45:44Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind, model-rotated: sonnet, opus)
**Converged:** Yes (iteration 2, a different model from iteration 1, found zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 5 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty until this iteration's fix commit; the 6.0 baseline suite passed clean, so the first reviewer ran on unmodified branch work)
- [WARNING] web/index.html:~19011 (paintOrg) — the needs-you badge's own `role="img" aria-label="Needs you"` is inert inside a `<button>` that has its own `aria-label`, so needs-you was conveyed visually only (the list row exposes LROW_WARN because it sits OUTSIDE a button). --> FIXED (commit 3bb6c05a): folded `, needs you` into the node button's accessible name when needsYou.
- [WARNING] docs/browser-checks/render-org-rings-2576.js + web/index.html `.onode .oring` — the check asserted ring existence + the static dasharray attribute but never the rendered laid-out size (unlike render-detail-ring-1915's `w>0 && h>0`), and `.oring` was the only ring in the file relying on `inset` alone without an explicit px size (`.dring`/`.lring`/`.agauge svg` all pair them). --> FIXED (commit 3bb6c05a): gave `.onode .oring` an explicit 54px box (44px face + 5px each side) matching the sibling pattern, and added a `ringLaidOut` (getBoundingClientRect) assertion for every node.
- [NIT] web/index.html:~18960 — the NODE_EXTENT comment still said the node's 5px outer ring was a "state ring"; it is the context ring now. --> FIXED (commit 3bb6c05a).
- (self-caught in the same commit) the node-render slice in web.org-view.test.js used a fixed 700-char window; the added a11y comment pushed the assertions out of it (the eval-slice trap). Bounded the slice to the push's own `</button>');` close.

#### Iteration 2
**Reviewer model:** opus (a different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
**Converged** — no new actionable findings. Two NITs recorded (below), both documented tradeoffs the reviewer explicitly called defensible/non-blocking.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:~19011 | BRANCH | Needs-you badge aria-label inert inside a labeled button (visual-only) | FIXED | 3bb6c05a |
| 2 | 1 | WARNING | render-org-rings-2576.js / .onode .oring | BRANCH | No laid-out-size assertion + .oring lacked explicit px size | FIXED | 3bb6c05a |
| 3 | 1 | NIT | web/index.html:~18960 | BRANCH | NODE_EXTENT comment says "state ring" | FIXED | 3bb6c05a |
| 4 | 2 | NIT | web/index.html:~19030 | BRANCH | Reused ONODE_WARN's nested aria-label may be redundantly announced alongside the folded button name | DEFERRED | Aria-hiding only the node variant would reintroduce the LROW_WARN/ONODE_WARN drift the class-swap avoids; reviewer called the tradeoff defensible |
| 5 | 2 | NIT | web/index.html:~1338 / paintOrg | BRANCH | Folding UNKNOWN state (not just idle/working, per Mona's cited wording) into the no-arc group is the author's extension | DEFERRED | Intended + documented in the plan; flagged to Mona in the #2577 completion note. Reversible; a distinct unknown channel is a follow-up, not a blocker |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:~18960 — NODE_EXTENT "state ring" wording (iteration 1) --> FIXED.
- [NIT] web/index.html:~19030 — badge nested aria-label possible redundant announce (iteration 2) --> deferred, defensible tradeoff.
- [NIT] web/index.html:~1338 — unknown state lost its distinct dashed arc in the org view (iteration 2) --> deferred, documented + flagged to Mona.

### Strengths (across all iterations)
- orgRing is a faithful clone of detailRing/lrowRing (same pctOf/memBand/.gt/.gf), so the context gauge is one source of truth across grid/list/detail/org, and themes dark for free via the existing .gt/.gf overrides (iterations 1, 2).
- ONODE_WARN is DERIVED from LROW_WARN by a single class swap, so the two needs-you glyphs cannot drift; a node test pins the identity (iterations 1, 2).
- The design tradeoff (state arcs off the ring; only needs-you badged) is documented in the plan with the rejected alternative and what would change the author's mind (iteration 1).
- The hermetic browser-check drives the real paintOrg with injected readings and asserts laid-out size, band-vs-arc tracking, badge-on-needs-you-only, and no `::after` arc, with documented RED arms; registration is complete and leaves EXPECTED_SITES/EXPECTED_CATCH_SITES untouched (verified line-by-line) (iterations 1, 2).
- Removing `.onode.attn/.work/.unk::after` left no orphaned references anywhere in the codebase (iterations 1, 2).
