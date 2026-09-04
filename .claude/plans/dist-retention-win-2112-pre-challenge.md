---
pre_challenge: true
method: challenge-loop
branch: dist-retention-win-2112
diff_hash: fb9513a7cb676c3f28b4579bff414918ee383366c44fe1cb79f8a2005873e698
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T04:21:46Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 WARNING, 2 NITs (0 BLOCKERs, 0 CONVENTIONs) + 1 pre-existing NIT noted
**Fixed:** 1 WARNING + 2 NITs | **Deferred:** 1 NIT (pre-existing, immaterial) | **Asked:** 0

Safety-critical review (the tool DELETES irreversible release artifacts behind
`--prune --yes`). Both iterations focused on the deletion-safety invariant: NEVER
delete a non-triple/protected/unrecognised file, and NEVER prune a family whose
served release is unidentifiable. No blocker in either round.

### Iteration 1
- [WARNING] plan — claimed arm64 output is "byte-identical"; it is NOT (header now
  `[arm64]`, JSON gained additive `prune_allowed`, refuse says "tarball/zip"). The
  real guarantee is deletion-behavior-identical + all 44 arm64 arms pass. --> FIXED
  (corrected the plan's invariant + weakest premise). commit 28842aa8
- [NIT] dist-retention.sh:51 — `--help` `sed -n '2,37p'` spilled 4 code lines after
  the block shrank. --> FIXED (`2,33p`). commit 28842aa8
- [NIT] tests — missing win pins for artifact-filename served protection (skew) and
  a win stray file. --> FIXED (added win Arm 6b + 6c). commit 28842aa8

### Iteration 2
- CONVERGED. 4 STRENGTHs confirming: no over-deletion constructible under adversarial
  input (glob excludes both aliases, version-token gate blocks traversal/metachars,
  `[ -e ]`-guarded rm); the win fail-safe fires for an absent AND a version-less
  pointer; served protection is doubly-safe (version-string + artifact-filename
  fallback); the unvalidated `SERVED_VERSION` is safe by construction (only ever
  appended to KEEP_LIST; matched as a literal case-subject).
- [NIT] dist-retention.sh (json served_version via raw `%s`) — a control char could
  technically malform the JSON. **DEFERRED: pre-existing #1605 behavior (not this
  change), the value is `[^"]*` so no quote breaks the string, and nothing consumes
  the JSON. Immaterial.**

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | plan's false "byte-identical" claim | FIXED | 28842aa8 |
| 2 | 1 | NIT | --help sed range over-prints code | FIXED | 28842aa8 |
| 3 | 1 | NIT | missing win artifact-fallback + stray pins | FIXED | 28842aa8 |
| 4 | 2 | NIT | raw %s served_version in JSON | DEFERRED | pre-existing #1605, immaterial, unconsumed |

### Strengths
- Deletion safety structurally sound: every delete path is `triple_files "$v"` where
  `$v` was glob-enumerated (`kosmos-[0-9]*-<arch>.<ext>`, excluding both aliases/pkg/
  other-platform) AND passed the `*[!0-9A-Za-z.+_-]*` gate; each path is `[ -e ]`-
  guarded. No dist deletes a non-triple file.
- Both families' served release protected in- and out-of-window via version-string +
  artifact-filename fallback; win fail-safe refuses to prune without a served pointer.
- arm64 deletion behavior preserved: all 44 of #1605's original arms pass unchanged.
- 66 tests, 0 fail; every arm asserts file-level postconditions and the discriminating
  arms each fail on their specific bug.

### Handoff note
Dry-run by default; `--prune` requires `--yes` and is Josh's call. This tool has never
run `--prune` on the real dist. Not wired into any release/cron step (standalone).
