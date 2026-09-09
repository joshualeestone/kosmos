---
pre_challenge: true
method: challenge-loop
branch: cog-svg-gear
diff_hash: 3695a20a4be600b9727852d15c7529e827842c2625a9534b3fe37a2f7e3bf7d6
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T13:39:19Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero BLOCKER/WARNING/CONVENTION; only STRENGTHs)
**Total findings:** 1 BLOCKER (fixed), plus 1 out-of-scope CONVENTION note
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet (general-purpose subagent)
**New findings:** 1 BLOCKER, 1 CONVENTION (out-of-scope note)
**Self-generated:** 0
- [BLOCKER] docs/browser-checks/render-firstrun-stepcap-gear-0640.js (Origin BRANCH) — the gear browser-check pinned the OLD glyph (asserts .s4-gear font-size 40-48, display:flex, line-height collapsed). My SVG change removes those, so the check would red. It IS wired into tools/browser-checks.sh, so it runs in CI. --> FIXED: updated the probe (gearHasSvg, gearGlyph, justifyItems, display grid) and both assertions (box 48-58 + svg present + no glyph text; grid place-items:center + svg present), dropping the glyph font/flex/line pins. The unrelated arms (title-bold/size, Login-Items control, S3 tmux) left untouched.
- [CONVENTION] web/index.html:~17129 — a SEPARATE U+2699 glyph (the world-rename `.worldsw-cog` button, VS15) remains; out of scope for this PR (different element, Josh's complaint was the notification cog). Deliberately deferred; noted as a candidate for the same SVG treatment if it ever shows the offset.
- STRENGTH: the SVG gear is well-formed, symmetric about the viewBox centre, centres by geometry.

#### Iteration 2 (after the browser-check fix)
**Reviewer model:** sonnet (general-purpose subagent)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** — reviewed BOTH the SVG and the updated browser-check together, verified consistency, found no issues. Confirmed: every outer vertex is point-symmetric about (16,16); box stays 52px via global border-box + 11px padding leaving a 30px content area the svg fills; the check-update will PASS the new code (place-items:center resolves both alignItems and justifyItems to 'center', display 'grid', textContent '', box 52); the updated assertions are NOT vacuous (a revert to glyph or flex reds them); the unrelated arms are byte-identical to main; no dangling references to the removed probe fields.

### Root cause (Josh, said 5-6 times)
The notification cog read high-and-left build after build because it was the U+2699 GLYPH, whose asymmetric font side/vertical bearings no box-centring can fix. It looked centred ONLY in headless Chrome, whose fallback glyph differs from macOS's system font, so the regression was invisible to headless verification (this is disclosed against my own #2460, which I "verified" headless). The durable fix is a drawn SVG path that centres by its own symmetric geometry. Josh approved the vector (Splinter relay, "don't care PNG or vector, just want it centered").

### Final Ledger
| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | render-firstrun-stepcap-gear-0640.js | BRANCH | check pinned the old glyph | FIXED | updated to assert the SVG |
| 2 | 1 | CONVENTION | web/index.html:~17129 | BRANCH | separate world-rename U+2699 glyph | DEFERRED | out of scope; candidate for later |

### Strengths
- SVG gear centres by construction (point-symmetric path, hole via evenodd), the real durable fix, not another box-nudge (iter 1+2).
- The browser-check update is consistent with the code, passes it, and stays non-vacuous (iter 2).

### Validation
- 6.0/6g/6j: node suite PASSED (typescript stack, hash 3695a20a4be6). Subdir audit passed (no CLAUDE.md changed). Browser-check assertions verified by the reviewer to pass the new code; CI runs tools/browser-checks.sh to confirm live.
