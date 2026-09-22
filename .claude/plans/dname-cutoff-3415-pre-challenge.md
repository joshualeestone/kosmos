---
pre_challenge: true
method: challenge-loop
branch: dname-cutoff-3415
diff_hash: aa7f08a9cceed78a1e196aa1c95142275148e51156762c6b6d201803f7b3a905
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T20:03:44Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 found zero BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 0
**Fixed:** 0 | **Deferred:** 0 | **Asked:** 0

Fixes Josh's live 0.6.88 finding: the agent name is clipped at the bottom on the
detail cards. Root-caused by headless measurement: `.dnamerow .dname` renders at
up to 24px (1.5rem, shrunk by fitDetailName) but inherits a ~16px line-height as
a LENGTH from the detail column, so the line-box is shorter than the glyphs and
the `overflow: hidden` kept for the width ellipsis clips the descenders
(scrollHeight 22 > clientHeight 16). Fix: a scoped, unitless `line-height: 1.15`
on `.dnamerow .dname` so the line-box tracks the shrunk font-size (clip gone,
short and long names).

**Single-model convergence (kosmos#2032 caveat):** converged on iteration 1, so
only opus reviewed. Accepted for a 1-line, scoped CSS fix that is (a) verified by
headless measurement (clippedBottom true->false), (b) pinned by a new browser-check
assertion the reviewer confirmed detects the clip and fails on revert, and (c)
scoped so no shared `.dname` consumer regresses.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0
**Self-generated:** 0
**Converged** — the reviewer verified the unitless line-height tracks
fitDetailName's dynamic `--dname-size`; that the rule is scoped to `.dnamerow
.dname` and every other `.dname` (`#tk-title`, `#pj-one-name`, the h2 titles) is
outside `.dnamerow` and untouched; that the width ellipsis and flex centering are
intact; and that the new assertion's `scrollHeight > clientHeight` genuinely
detects the clip and would fail on revert. Ran the browser-check: all PASS
including Part 5 (#3415) `shortClipped:false, longClipped:false`. No em/en dash.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| (none) | 1 | - | - | - | No findings | - | - |

### Outstanding questions (ASKED)
None.

### NITs
None.

### Strengths
- Minimal, correctly-targeted fix: a scoped unitless line-height that tracks the
  dynamic name sizing rather than a hardcoded pixel value, paired with a
  regression assertion that measures the actual clip condition; shared `.dname`
  consumers provably unaffected (iteration 1).
