---
pre_challenge: true
method: challenge-loop
branch: test-install-tmpdir-slash-6252
diff_hash: dd08ea31e62aa523c15157840f912bbd7c59f3daf8f674d81b3541b4883857f9
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T23:33:09Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (blind reviewer: sonnet)
**Converged:** Yes, at iteration 1 (all findings deferred as known tradeoffs / accurate-as-written).
**Total findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs.
**Fixed:** 0 | **Deferred:** 3 | **Asked:** 0

This is a one-line hotfix for #6252 (a regression from #4298): tools/test-install.sh's SB sandbox
root now strips a trailing slash so a cut shell's trailing-slash TMPDIR cannot double the slash that
the board-plist hash reads. Validation was PM-proven, not run here: Liu Kang ran test-install.sh at
this exact head under a trailing-slash TMPDIR (415 pass / 0 fail, vs 364/51 on the unfixed head),
the static guard reports 0 failures, and the box is reserved for the 0.7.51 cut so no local full
suite ran (CI on the PR is the full run). The convergence is corroborated by Scorpion's independent
review of this head (approved; he reached the same conclusion on the one finding below).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty; the fix and comment are in the pre-loop commit f8b89841e, so BRANCH, the code under review)
- [WARNING] tools/test-install.sh:108 -- `${_sbroot%/}` strips only ONE trailing slash, while setup.sh normalizes KOSMOS_HOME with `tr -s '/'` (squeeze all repeated) THEN `%/`. A TMPDIR ending in `//` or carrying an interior `//` would still give SB a double slash and re-create the #6252 hash mismatch. --> DEFERRED. The real cut shell is fixed: macOS sets TMPDIR with exactly one trailing slash (proven: 415/0 at this head). The residual requires a pathological hand-set TMPDIR that does not occur. Liu Kang prescribed this minimal `%/` form and asked to keep it to one change for a fast re-cut; Scorpion independently reviewed and called the `tr -s` gap non-blocking. Changing it would also move the head off the PM-proven, Scorpion-approved f8b89841e. The substance is filed as the #6252 follow-up card (a CI/unit check with a trailing-slash TMPDIR, and optionally matching setup.sh's full normalization at the hash site).
- [NIT] tools/test-install.sh:102-107 -- the comment names "install gate 4b" and could read as if one trailing-slash strip fully reproduces setup.sh's normalization. --> DEFERRED. "4b" is accurate (the PM named step 4b as the failing gate); the comment states the fix strips a trailing slash, not that it fully matches setup.sh; and a comment-only edit would move the head off the proven f8b89841e. The `tr -s` nuance is captured in the follow-up card.
- [NIT] tools/test-install.sh:600 -- confirmed this is the ONLY site that hashes a path built from SB; the other `$SB` uses are literal filesystem paths / `grep -F`/`pgrep -f` (same literal string throughout, so a double slash is harmless) and the line-311 KOSMOS_HOME hash goes through setup.sh's normalization. --> informational, no action (it corroborates the blast-radius: test-install.sh is the only affected script).

**Converged** -- the one WARNING is a documented, non-occurring-input tradeoff (deferred), the NITs are accurate-as-written / informational; zero NEW actionable findings remain.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-install.sh:108 | BRANCH | %/ strips one slash vs setup.sh's tr -s + %/ (residual on a pathological TMPDIR) | DEFERRED | real cut shell fixed + proven; PM-prescribed minimal form; Scorpion non-blocking; follow-up card |
| 2 | 1 | NIT | tools/test-install.sh:102 | BRANCH | comment: "4b" + normalization-parity reading | DEFERRED | 4b accurate (PM); no false parity claim; head is proven |
| 3 | 1 | NIT | tools/test-install.sh:600 | BRANCH | only one path-hash site; others harmless | DEFERRED | informational, corroborates blast-radius |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- [NIT] test-install.sh:102 -- comment precision (iteration 1)
- [NIT] test-install.sh:600 -- single hash site confirmed (iteration 1)

### Strengths
- Minimal and scoped to the one issue; keeps the `${TMPDIR:-/tmp}` default; keeps a positional template the #4298 static guard accepts (guard 0 failures, control line passes).
- The comment ties the cause to the hash site and explains why the suite's kt-sandbox TMPDIR (no trailing slash) hid the bug.
- Independently PM-proven at this head (415/0 vs 364/51) and Scorpion-approved.
