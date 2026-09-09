---
pre_challenge: true
method: challenge-loop
branch: bc-surface-map-2518
diff_hash: 99515d6af5dcf19b07bd16a47ba74a631989d43945c0a331cb9ee06f04ecac28
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T21:57:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (converged at 3; two cheap NIT locks applied after)
**Converged:** Yes (iteration 3 returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 12 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 7 NITs)
**Fixed:** 10 | **By-design (documented):** 2 | **Asked:** 0

kosmos#2518 (option-1, no-browser): the coarse browser-check gate refuses a web/ change only
when NO browser-check is touched, so a PR can stale the SPECIFIC check for a changed surface
(cost 4 cut attempts on 0.6.49: #2498, #2487). This adds a surface->check map: each check
declares `// Browser-check-surface: <tokens>`, and a companion gate refuses a web/index.html
change touching a mapped token (whole-token boundary match) without updating that check --
pass by updating it, or a per-check named override; the blanket `Browser-check:` trailer does
NOT excuse it (the precision that catches #2498). Incremental (unannotated checks keep the
coarse behavior), zsh-safe, fail-soft. Splinter approved the flip from option-2 (a scheduled
full-set CI run) after I showed option-2 false-reds headless per browser-checks.yml's own docs.

Reviewer models: opus (iter 1), sonnet (iter 2), opus (iter 3).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
- [WARNING] `for ann in "$bcdir"/*.js` aborts under zsh no-match (zsh-unmatched-glob trap), contradicting the zsh-safe claim. --> FIXED (d7f56ee4): find + newline while-read + `[ -d ]`. Verified rc=0 under zsh with an empty dir.
- [WARNING] `grep -F` matched pj-parent inside pj-parenthetical (over-fire). --> FIXED (d7f56ee4): whole-token boundary match with ERE escaping; arm proves the substring does not fire.
- NITs: removed dead locals (f/dstat/dpath/chk); documented the double-trailer override path.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 NIT
- [WARNING] key only case-classed the leading letter, unlike the sibling gate's documented case-insensitivity. --> FIXED (82b47c12): full char-classes on the annotation + override keys; arm proves 'browser-check-Surface:'.
- [WARNING] the fail-soft test arm hit the empty-content path, not the real git-diff-failure branch + its diagnostic. --> FIXED (82b47c12): a real non-git-dir arm asserts rc=0 AND the 'could not diff' message.
- [WARNING] no zsh arm in the (bash-only) suite -> a future zsh-fix reversion would go undetected. --> FIXED (82b47c12): a self-defending zsh arm reproduces the multi-token refuse under zsh.
- [NIT] basename unescaped in the override sed. --> FIXED (iter 3, 7beac414).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs/WARNINGs/CONVENTIONs, 3 NITs
**Converged.** 4 STRENGTHs: zsh-safety comprehensive (verified under real zsh 5.9); gate logic precise (boundary + escaping); bypass surface sound (blanket trailer does not excuse, override needs a named check + non-empty reason); fail-soft honest (returns 0 AND says so); test arms non-vacuous.
- [NIT] updated-check grep interpolated dir+basename raw (`.` in `.js` an ERE any-char) -- a permissive match is the UNSAFE direction (false "updated" -> skip -> miss staleness). --> FIXED (7beac414): escaped both.
- [NIT] no wrong-name-override arm. --> FIXED (7beac414): an override naming a different check still refuses (per-check scope).
- [NIT] token granularity: a declared token on a cosmetic CSS line fires the gate. --> BY DESIGN (an honesty aid with a per-check escape hatch); documented as the map's friction cost.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | browser-check-surface-gate.sh | BRANCH | zsh no-match glob aborts the function | FIXED (d7f56ee4) |
| 2 | 1 | WARNING | browser-check-surface-gate.sh | BRANCH | substring over-fire (grep -F) | FIXED (d7f56ee4) |
| 3 | 2 | WARNING | browser-check-surface-gate.sh | BRANCH | key not fully case-insensitive | FIXED (82b47c12) |
| 4 | 2 | WARNING | test | BRANCH | fail-soft arm missed the git-diff branch | FIXED (82b47c12) |
| 5 | 2 | WARNING | test | BRANCH | no self-defending zsh arm | FIXED (82b47c12) |
| 6 | 3 | NIT | browser-check-surface-gate.sh | BRANCH | updated-check match permissive (unsafe dir) | FIXED (7beac414) |
| 7 | 3 | NIT | test | BRANCH | no wrong-name-override arm | FIXED (7beac414) |
| 8 | 3 | NIT | browser-check-surface-gate.sh | BRANCH | token granularity friction | BY DESIGN (documented) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Strengths (across all iterations)
- zsh-safety is comprehensive and VERIFIED under real zsh 5.9 (find/tr while-reads, no tied vars), with a self-defending zsh test arm so a reversion reds in the suite.
- The whole-token boundary regex + ERE escaping catches a token add/remove/rename (the #2487 shape) without over-firing on substrings; the blanket trailer cannot excuse a surface staleness (the #2498 precision), and the override is per-check-scoped with a non-empty reason.
- Fail-soft returns 0 AND emits a diagnostic (never a silent skip); the branch never trips its own gate; unannotated checks keep the coarse-gate behavior, so the map is incremental and never falsely complete.
- 12 non-vacuous test arms; no em dash in any changed file.

### Ownership
Producer (map + gate + test): PigeonPete. Validator (CI/release-flow integration + growing the map to the full set): Baron Draxum (release/browser-check lane), flagged by Splinter.
