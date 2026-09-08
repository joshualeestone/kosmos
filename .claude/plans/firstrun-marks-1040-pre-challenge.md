---
pre_challenge: true
method: challenge-loop
branch: firstrun-marks-1040
diff_hash: 4bfc04e02226c775107d9b5b949e3df895f75892fc1872d3c33883a5d0b9ddb2
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T15:16:02Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 6 WARNINGs, 2 CONVENTIONs, 4 NITs (0 BLOCKERs)
**Fixed:** 5 WARNINGs + 2 CONVENTIONs | **Deferred:** 1 WARNING (tracked on #1040) + 4 NITs | **Asked:** 0

Adds the four #1040 providers to the first-run model picker as coming-soon rows and
updates the six-provider assertions to ten. Four blind passes on alternating models
(Sonnet, Opus, Sonnet, Opus). Each iteration's fix was re-reviewed by the next; the
loop caught two cross-file drifts my change caused (a ruling-guards anchor, a stale
provenance doc) and two issues my own iteration-2 fix introduced (a stale count and a
dangling citation in the provenance doc), plus two em dashes in my plan prose.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] cross-surface roster gap (firstrun vs the <select> menus) --> DEFERRED: documented in the plan file and tracked on kosmos#1040 as piece 2b; coupled to #770 placeholder + the agent instruction block + the missing Grok mark. Reviewer (iter 4) confirmed the deferral reasonable.
- [CONVENTION] no plan file for this branch --> FIXED: added .claude/plans/firstrun-marks-1040.md.
- [NIT] sourcing commit not an ancestor (separate branch) --> DEFERRED: marks inlined byte-for-byte, no runtime dependency.

#### Iteration 2
**Reviewer model:** opus
- [WARNING] web.ruling-guards.test.js anchored "last provider row" on data-pmark=mistral, no longer last --> FIXED: re-pointed to minimax + corrected comment.
- [WARNING] docs/provider-marks-provenance.md still listed the four as "still to source" --> FIXED: converted to a self-contained sourced record (vendor source + colour per mark).
- [NIT] root-vs-path currentColor / gradient units --> DEFERRED: harmless, renders identically.

#### Iteration 3
**Reviewer model:** sonnet
- [WARNING] provenance "app renders 6 data-pmark values" stale (ten now) --> FIXED: added a #1040 note without rewriting the dated 2026-08-26 measurement.
- [WARNING] provenance manifest "sections 7-10" citation dangled (they land with #2484) --> FIXED: softened to future tense; the self-contained summary is the record until then.
- [CONVENTION] two em dashes in my plan prose --> FIXED: replaced with "--".
- [NIT] "Open weights" tier categorization for DeepSeek/MiniMax --> DEFERRED: a deliberate label choice, consistent with the existing mixed pattern (Qwen/Mistral).

#### Iteration 4
**Reviewer model:** opus
- [WARNING] cross-surface roster gap --> DUPLICATE of iteration 1's deferred entry (reviewer confirmed documented + reasonable, not a hidden blocker).
- [NIT] STEP-length comment figure 75695 vs measured 75672 --> DEFERRED: immaterial (~41k headroom) and an inherently drift-prone measured offset.
- **Converged** — zero new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | firstrun vs selects | cross-surface roster gap | DEFERRED (2b, #1040) |
| 2 | 1 | CONVENTION | .claude/plans/ | no plan file | FIXED |
| 3 | 2 | WARNING | web.ruling-guards.test.js | anchor on non-last row | FIXED |
| 4 | 2 | WARNING | provider-marks-provenance.md | "still to source" stale | FIXED |
| 5 | 3 | WARNING | provider-marks-provenance.md | "renders 6" stale | FIXED |
| 6 | 3 | WARNING | provider-marks-provenance.md | dangling manifest citation | FIXED |
| 7 | 3 | CONVENTION | .claude/plans/ | em dashes in prose | FIXED |
| 8 | 4 | NIT | web.firstrun-model.test.js | comment figure off by 23 | DEFERRED |

### Outstanding questions (ASKED, still unresolved)
None.

### Strengths (across iterations)
- Four new rows structurally identical to existing coming-soon rows; all SVGs well-formed; no hardcoded black; MiniMax gradient id collision-free; Kimi two-tone correct.
- Every six->ten test count independently re-derived and matching the live markup; no assertion passing for the wrong reason.
- Anchor re-point to minimax is unambiguous (unique in file, genuinely last row).
- Provenance doc internally consistent after edits; no em dashes introduced in any authored prose.
- The piece-2b deferral is documented with real coupling reasons (evidence-backed, not a hidden blocker).
