---
pre_challenge: true
method: challenge-loop
branch: pkg-logo-1879
diff_hash: dd1e2ac16ed4962d6012db6ec1e8c45666356d088d4e6b155ab781a6617b769b
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T21:00:44Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 2 | **Asked (awaiting user):** 0

(Re-run after adding the plan file `.claude/plans/pkg-logo-1879.md`, which the
pre-challenge-gate requires alongside this proof. The code under review is identical
to the prior converged pass; this pass re-reviews code + plan and re-fingerprints.)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] no-brand-refs-1881.test.js:78 — Latent fragility in an EXISTING test (reads every tracked file as utf8, which decodes binary lossily rather than throwing, so a future binary asset whose bytes spell a brand token could false-positive). Out of scope for this PR; the two added PNGs were binary-grepped and contain none of book-io/booktoken/stuff-io/$stuff, so they pass. --> DEFERRED: not this PR's code; my assets pass the guard.
- [NIT] tools/build-installer-pkg.sh:83 — scaling="none" on a 144px image is soft on Retina (installer backgrounds have no @2x path). --> DEFERRED: documented, deliberate tradeoff in the plan; matches Tailscale; Josh does the visual pass on the cut.

**Converged** — no NEW BLOCKER/WARNING/CONVENTION; no ASKED findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | no-brand-refs-1881.test.js:78 | Existing test reads binary as utf8 (latent) | DEFERRED | Out of scope; added PNGs verified to contain no brand tokens |
| 2 | 1 | NIT | tools/build-installer-pkg.sh:83 | Retina softness at scaling=none | DEFERRED | Documented tradeoff; matches Tailscale; no @2x mechanism |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] no-brand-refs-1881.test.js:78 — existing-test binary/utf8 fragility (iteration 1)
- [NIT] tools/build-installer-pkg.sh:83 — Retina softness at scaling=none (iteration 1)

### Strengths (across all iterations)
- macOS Distribution syntax correct: <background>/<background-darkAqua> are valid installer-gui-script children; alignment=bottomleft, scaling=none, mime-type=image/png all valid; file names resolve from --resources install/pkg-resources/ where both PNGs live. (iteration 1)
- Both light and dark backgrounds declared: without background-darkAqua a dark-mode install renders no logo; the inline comment explains why; degrades safely on pre-dark-mode Installer. (iteration 1)
- Input-hash interaction correct and plan accurate: pkg-inputs.sh streams install/pkg-resources/** + the build script, so both PNGs and the build-script edit move the input sha and pkg_publish_needed returns "inputs differ" on the next cut; no guard bypassed. (iteration 1)
- PNGs well-formed (144x144 8-bit RGBA, non-interlaced) with no tEXt/iTXt metadata chunks, so no author/tool string leaks into the package. (iteration 1)
- No signing/notarize/staple risk: only resource images added to a payload-free pkg (no Mach-O); pkg-input-guard test uses synthetic temp dirs and is untouched; no test asserts exact pkg-resources contents or distribution.xml text. (iteration 1)
