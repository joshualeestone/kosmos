# consolidated-restyle challenge ledger
Two independent blind reviews returned 2026-08-26 ~14:03 CDT.
NOTE: both agents produced findings but the Agent tool result never surfaced;
recovered from subagents/*.jsonl. Ledger on disk so a restart cannot lose it.

| # | Src | Cat | Site | Issue | Status |
|---|-----|-----|------|-------|--------|
| 1 | r1 | BLOCKER | web/index.html:2076 | consolidated `padding:0` orphans .apphead's -24px mirror margins; under new overflow:hidden the update/offline notice is CLIPPED (measured, screenshotted). Fix: margin:0 0 var(--space-6) on the >.apphead override | NEW |
| 2 | r2 | WARNING | web/index.html:2187 | `display:none` on .lstate removes agent state from the ACCESSIBILITY TREE, not just the eye. Only 'attn' keeps an aria-label. Fix: .vh visually-hidden copy of copy.label (idiom exists at :9437) | NEW |
| 3 | r2 | WARNING | web/index.html:2308-2339 | right column has no floor at short heights; Members absorbs all shortfall, becomes head-only under ~500px with no scroll escape (#pj-add-member unreachable) | NEW |
| 4 | r1+r2 | WARNING | web/index.html:2319,2326 | `align-items:start` outranks deliberate `align-items:center` at :2477; + control stops centring on Members and Tasks heads | NEW |
| 5 | r1+r2 | WARNING | web/index.html:2104 | selected-project state carried by sub-3:1 differences in BOTH themes; file's own :60/:72 comment declares 3:1 the floor (SC 1.4.11). Plan scoped it to hover-collision only; resting state is under too | NEW |
| 6 | r1 | WARNING | web/index.html:2012 | same padding:0 makes #conn full-bleed; rounded card flush to window edges. #askcard unaffected (own margin) | NEW |
| 7 | r1 | WARNING | docs/browser-checks/render-consolidated-layouts.js:55 | forceNothingOpen bypasses pjMarkOpen(null), so the "nothing open" screenshot shows a lit aria-current row: a state no person reaches | NEW |
| 8 | r1 | WARNING | web/index.html:2035 | five scroll regions hide their scrollbar track in the same pass that removes the page-level scroll fallback; clipped content has no indication it continues | NEW |
| 9 | r1+r2 | NIT | web/index.html:2246/2135 | folded projects railhead ground asymmetric (fold-p margin-left:0 outranks new -8px) | NEW |
| 10 | r2 | NIT | web/index.html:2385 | Files sticky .dlab pins at top:0 of a container with 14px padding; rows scroll through the strip | NEW |
| 11 | r2 | NIT | web/index.html:6636 vs 7054 | door says "Settings", the screen it opens still says "Project settings" | NEW |
| 12 | r1 | NIT | web.layout-picker.test.js:61 | tempered guard can start matching at a COMMENT occurrence of .composer and inspect the next rule | NEW |
| 13 | r2 | NIT | web.consolidated-980.test.js:21,23,30,32 | four assertions match whole 1.2MB PAGE rather than a sliced region | NEW |
| 14 | r1 | NIT | web/index.html:2021 | repeat(38,auto) / rows 39-41 is a five-site magic number with no back-reference | NEW |
| 15 | r2 | CONVENTION | CLAUDE.md | repo root has no CLAUDE.md; org conventions not written down in-repo. OUT OF SCOPE for this branch | DEFERRED: not this branch's diff; raise separately |

Strengths (both, for the proof file): body-child counter ships positive controls
(depth===0 tripwire + children>=20 floor); --k-side/--k-side-2 in all three theme
blocks; placeholder swap preserves aria-label and captures markup wording once;
pjMarkOpen writes aria-current not just a class; Files-above-Members done purely
with grid rows over display:contents so DOM order and the tab view are untouched.
r2 verified rebase interaction clean: neither 2c05f16 nor cae0a88 touched web/index.html.
