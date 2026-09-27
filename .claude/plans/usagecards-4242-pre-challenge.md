---
pre_challenge: true
method: challenge-loop
branch: usagecards-4242
diff_hash: 17b6de77cef5687ef78ec5517f88f8aa58aeff498cfdfb9a97a5d777d0a0c99c
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T21:49:37Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 24 (1 BLOCKER, 8 WARNINGs, 3 CONVENTIONs, 12 NITs), 2 of them duplicates of earlier entries
**Fixed:** 19 | **Deferred:** 2 | **Asked (awaiting user):** 0 | **Duplicates:** 2 | **NIT noted, not acted on:** 1

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** none (6.0 initial validation pass)
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (6.0's own pass, BRANCH by instruction)
- [BLOCKER] final-validation: browser-check surface gate (#2518) read the word "grid" in the new CSS comment as render-phone-offline-718's #grid token --> FIXED (commit 417bfabca, comment says "layout"; bc-surface-map covering now returns nothing, and a control line with "grid" still maps)

#### Iteration 2
**Reviewer model:** unknown (not recorded across a context compaction)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] render-token-usage-2617.js: 600 is not the tightest two-column width (the old viewport query switched at 560) --> FIXED (417bfabca, then 61dc6b495 sizes the window for a 541px and a 540px section)
- [WARNING] web/index.html .tv-mh: align-items flex-start lost the name/total baseline --> FIXED (417bfabca, back to baseline)
- [WARNING] render-token-usage-2617.js: the one-line-total arm could not fail --> FIXED (cc42fd576: measured that nowrap is inert, the number and share have no break opportunity; the arm that claimed to test it was dropped and the CSS comment and plan say so)
- [NIT] web/index.html .tv-nm min-width: 0 lets a long word run under the total --> FIXED (417bfabca)
- [NIT] README row did not name #4242 --> FIXED (417bfabca)
- [NIT] Range not detached --> FIXED (61dc6b495)
- [NIT] the grid should switch on a container query, not the viewport --> FIXED (0af21385b). Load-bearing: with the widest total forced in, a name wrapped at a 561px window, because the 560px viewport query left the cards two-up in a 513px section.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 4 of the above (all against lines this loop wrote)
- [WARNING] render-token-usage-2617.js: the 589 two-up arm sat 1px from the line, and a 15px scrollbar (measured) moved it across --> FIXED (61dc6b495, atSection sizes the window for the section and asserts the width it got)
- [WARNING] render-token-usage-2617.js: nothing distinguished the container query from a viewport query (an @media 588 mutation passed) --> FIXED (61dc6b495, a 500px section at a 1280 window must stack; the @media mutation reds it)
- [WARNING] plan / .tv-mh: the baseline was claimed but untested (flex-start and flex-end passed) --> FIXED (61dc6b495 and 14be293a8, a zero-size inline-block marks each baseline; tolerance under 0.5px so flex-start's 1px is caught; both mutations red)
- [CONVENTION] README row overclaimed nowrap and the container query --> FIXED (61dc6b495, 8dad678e6)
- [NIT] comment said usageAbbr stays under 1000.0M; 999,950,000 renders 1000.0M --> FIXED (8dad678e6: 999.9M beside 99.9% is pinned as the widest in practice; 1000.0M beside 100.0% wraps two names even at desktop, measured, so past it the check pins only a clean fallback; the usageAbbr edges are filed as #4244)
- [NIT] CSS comment said 236px; measured 238px --> FIXED (61dc6b495)
- [NIT] README called 589 the tightest two-up width --> FIXED (61dc6b495)
- [NIT] the clear arm could not see a total pushed past the card edge --> FIXED (61dc6b495, total must end inside the card's padding box)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 of the above
**Duplicates of prior findings (confirmed resolved):** 1 ([CONVENTION] nowrap inert, iteration 2)
- [WARNING] render-token-usage-2617.js: the baseline arm's under-0.5px tolerance may flake on a machine with other fonts --> DEFERRED: under align-items: baseline the two baselines coincide by construction whatever the fonts, so no font can flake it red. Only the flex-start mutant's 1px gap is font-dependent, so another font stack could make the arm blind to that mutant (a false green), never flaky. The fonts are system stacks and the checks run on macOS.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 3 of the above
- [CONVENTION] web/index.html: the unnamed @container query would move if a nearer ancestor (.dbox, shared by every Settings section) became a container --> FIXED (03c45b226, container-name: usage on #s-sec-usage, @container usage; removing the name reds the stacking arms, measured; the two older unnamed usage queries are unaffected)
- [NIT] same-height arm absent from the widest-total runs, which the README implied it covered --> FIXED (03c45b226, moved into armsAt)
- [NIT] expected section width parsed out of the view's label --> FIXED (03c45b226, its own field)
- [NIT] flex-start is caught by only a 1px gap between these fonts --> DEFERRED: enlarging the total for the reading can wrap the name and move the marker off its first line, a false red; the residual is the false green recorded under iteration 4.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] web/index.html .tv-tot: nowrap has no arm that can detect its removal --> DUPLICATE of iteration 2 (and iteration 4): kept as a disclosed guard against a future space between the number and its share; a computed-style assertion would pin the spelling, not the behaviour.
- [NIT] the named-container protection is untested (expected: it only matters once a nearer container exists)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html (CSS comment) | BRANCH | surface gate read "grid" in a comment | FIXED | 417bfabca |
| 2 | 2 | WARNING | render-token-usage-2617.js | BRANCH | 600 not the tightest two-column width | FIXED | 417bfabca, 61dc6b495 |
| 3 | 2 | WARNING | web/index.html .tv-mh | BRANCH | flex-start lost the baseline | FIXED | 417bfabca |
| 4 | 2 | WARNING | render-token-usage-2617.js | BRANCH | one-line-total arm could not fail | FIXED | cc42fd576 (nowrap measured inert, disclosed) |
| 5 | 2 | NIT | web/index.html .tv-nm | BRANCH | min-width: 0 overlap | FIXED | 417bfabca |
| 6 | 2 | NIT | README.md | BRANCH | row lacked #4242 | FIXED | 417bfabca |
| 7 | 2 | NIT | render-token-usage-2617.js | BRANCH | Range not detached | FIXED | 61dc6b495 |
| 8 | 2 | NIT | web/index.html .tv-charts4 | BRANCH | viewport query, not container | FIXED | 0af21385b |
| 9 | 3 | WARNING | render-token-usage-2617.js | SELF | fixed window 1px from the line | FIXED | 61dc6b495 |
| 10 | 3 | WARNING | render-token-usage-2617.js | SELF | container vs viewport not pinned | FIXED | 61dc6b495 |
| 11 | 3 | WARNING | plan, .tv-mh | SELF | baseline untested | FIXED | 61dc6b495, 14be293a8 |
| 12 | 3 | CONVENTION | README.md | SELF | row overclaimed | FIXED | 61dc6b495, 8dad678e6 |
| 13 | 3 | NIT | render-token-usage-2617.js | SELF | 1000.0M comment wrong | FIXED | 8dad678e6 (#4244 filed) |
| 14 | 3 | NIT | web/index.html | SELF | 236px vs 238px | FIXED | 61dc6b495 |
| 15 | 3 | NIT | README.md | SELF | 589 "tightest" | FIXED | 61dc6b495 |
| 16 | 3 | NIT | render-token-usage-2617.js | SELF | total past card edge unseen | FIXED | 61dc6b495 |
| 17 | 4 | WARNING | render-token-usage-2617.js | SELF | baseline tolerance vs other fonts | DEFERRED | exact by construction; residual is a false green only |
| 18 | 5 | CONVENTION | web/index.html | SELF | unnamed container query | FIXED | 03c45b226 |
| 19 | 5 | NIT | render-token-usage-2617.js | SELF | height arm absent at widest total | FIXED | 03c45b226 |
| 20 | 5 | NIT | render-token-usage-2617.js | SELF | width parsed from label | FIXED | 03c45b226 |
| 21 | 5 | NIT | render-token-usage-2617.js | SELF | flex-start caught by 1px only | DEFERRED | enlarging the total risks a false red |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] named-container protection is untested; it matters only once a nearer container exists (iteration 6)

### Strengths (across all iterations)
- Every guard added was shown to go red on the mutation it names: the old viewport query, a 515 threshold, flex-end, flex-start, an unnamed container, and the reverted inline tag.
- The widest total was measured, not assumed: 999.9M 99.9% holds, and the true extreme (1000.0M 100.0%) degrades to a two-line name with the total still clear and inside the card.
- A claim that could not be tested (nowrap) was said to be inert rather than dressed up as coverage.
