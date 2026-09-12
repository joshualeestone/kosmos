---
pre_challenge: true
method: challenge-loop
branch: agentnav-2916
diff_hash: 0c23f13e972589e55446cea975f79f725710cdc727e095d5213cef282b46f5d4
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T18:01:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 2 BLOCKERs, 2 WARNINGs, 1 CONVENTION, several NITs
**Fixed:** all actionable + 2 NITs applied | **Deferred:** the latent skills-deep-link NIT (documented, no live caller) | **Asked:** 0

A core-nav restructure (agent detail view). The loop's value here was concentrated and real: the
two BLOCKERs were the SAME class of defect (a browser-check clicking a removed pill through a
DYNAMICALLY-built `data-go` selector, invisible to a literal grep) found in two different files one
round apart, which is exactly why the loop iterates and varies the reviewer model. After the second
BLOCKER a repo-wide sweep of the dynamic-build-up pattern proved the full set (3 files) handled, and
iterations 3-4 found only accessibility-consistency and label-text points. Reviewer models
alternated sonnet/opus/sonnet/opus.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION
**Self-generated:** 0
- [BLOCKER] render-agent-nav.js — clicked the removed `memory` pill via a dynamic `data-go` selector (a literal grep missed it) and asserted 1:1 section reveal --> FIXED (232fccd0): iterate PILLS, assert group reveal; verified passing live
- [WARNING] web/index.html — skills lazy-load fires on every Instructions click, refetch + flicker --> FIXED: SKILLS_LOADED_FOR per-agent guard, reset in openDetail
- [WARNING] web/index.html — focus lands on group[0], folded-member deep-link focus not obvious --> FIXED: documented at the group map
- [CONVENTION] named-controls.js — "SEVEN SURFACES" comment stale after the sweep shrank to six --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 NITs
**Self-generated:** 0
- [BLOCKER] contrast.js — the SAME dynamic-selector pattern, a `#d-nav` sweep including `memory` --> FIXED (f737d3d3): dropped memory from the sweep; a comprehensive grep then proved exactly 3 files carry this pattern, all handled
- [NIT] d-sec-model aria-label "Model and Memory" overclaimed (region holds only model) --> FIXED: reverted to "Model"; the pill carries the grouping
- [NIT] skills load only from the click handler (latent deep-link gap) --> documented

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0
- [WARNING] d-sec-term aria-label "Advanced" contradicts its "This agent's Terminal" content, inconsistent with the model region kept as "Model" --> FIXED (60757d9): reverted to "Terminal"; only the nav pill is "Advanced"
- [NIT] skills deep-link gap (re-raised) --> already documented, accepted

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** — no actionable findings.
- [NIT] render-agent-nav.js control label said "six" others; SECTIONS grew to 8 --> FIXED (5058078): "seven" (label text only, logic was correct)
- [NIT] skills deep-link gap --> documented, accepted (no live caller; verified across all openDetail sites)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | render-agent-nav.js | BRANCH | clicked removed memory pill via dynamic selector | FIXED | 232fccd0 |
| 2 | 1 | WARNING | web/index.html | BRANCH | skills refetch on every Instructions click | FIXED | 232fccd0 |
| 3 | 1 | WARNING | web/index.html | BRANCH | folded-member focus not documented | FIXED | 232fccd0 |
| 4 | 1 | CONVENTION | named-controls.js | BRANCH | stale "seven surfaces" comment | FIXED | 232fccd0 |
| 5 | 2 | BLOCKER | contrast.js | BRANCH | same dynamic-selector memory sweep | FIXED | f737d3d3 |
| 6 | 2 | NIT | web/index.html | BRANCH | model aria-label overclaimed | FIXED | f737d3d3 |
| 7 | 3 | WARNING | web/index.html | BRANCH | term aria-label contradicts content | FIXED | 60757d9 |
| 8 | 4 | NIT | render-agent-nav.js | BRANCH | stale "six" count in a control label | FIXED | 5058078 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, deferred)
- The Skills lazy-load lives in the nav click handler, so a FUTURE direct section deep-link to
  'instr' would render the Skills list blank until the pill is clicked. No production caller passes a
  section today (verified across all openDetail sites); documented at the load site with the fix for
  when a deep-link is added.

### Strengths (across iterations)
- The dynamic-selector sweep is complete: the only remaining `data-go="memory"/"skills"` occurrences are the intentional `assert.doesNotMatch` guards in server.test.js.
- The group-reveal (`DETAIL_SECTION_GROUPS`/`DETAIL_SECTION_PILL`/`detailSectionGroup`) satisfies "combine pills, don't touch section internals": model-picker, memory controls, skills load, and instruction editor are untouched; DOM order matches the fold so focus-on-group[0] lands the keyboard correctly.
- The SKILLS_LOADED_FOR guard is correctly reset (openDetail) and bypassed by the add/delete paths (loadSkills called directly), so no double-fetch and no stale list.
- Accessibility: each section keeps a content-accurate aria-label; the two group pills' aria-controls list both real section ids; aria-current lands on the group pill.
- Node tests are non-vacuous: the folded set is pinned exactly to ['memory','skills'], every section is proven reachable via its pill, and the new pill labels + the absence of standalone Memory/Skills pills are asserted by content. No em dashes.
