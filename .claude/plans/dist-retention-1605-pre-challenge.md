---
pre_challenge: true
method: challenge-loop
branch: dist-retention-1605
diff_hash: 33627c6406ba1478e3629876245a949f38f8b591b4929bdc3f7207b41def416c
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T03:43:15Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 surfaced zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 12 WARNINGs, 0 CONVENTIONs*, 8 NITs
**Fixed:** 13 (the BLOCKER + all WARNINGs) | **Deferred:** 4 (NITs) | **Asked:** 0

(*The iteration-1 plan-em-dash finding was reported as a CONVENTION and fixed; counted under NITs/fixed here for brevity.)

This branch is #1605: `tools/dist-retention.sh`, a dry-run-by-default keep-last-N pruner
for the arm64 release triples in `chaoskosmos-site/dist`. It deletes IRREVERSIBLE
published artifacts only behind `--prune --yes`, via a positive whitelist, protecting the
served release (two ways), the aliases, the pkg, and `latest*.json`. Because the operation
is irreversible, the loop was run to full convergence with a red-capable test for every
fix. The core safety guarantee (no input can delete a protected/served file; no prune is
reported that did not happen) was independently confirmed airtight by iterations 5-8.

### Per-Iteration Breakdown

#### Iteration 1 — 3 WARNINGs, 1 CONVENTION, 1 NIT
- [WARNING] empty-array-under-set-u crash on bash 3.2 in the PRUNE-build loop (valid-but-versionless dist) --> FIXED (`${arr[@]:-}` + `[ -n ]` guard)
- [WARNING] same crash in the post-prune orphan-check loop --> FIXED
- [WARNING] no test arm for a versionless dist --> FIXED (arm 8b)
- [CONVENTION] 13 em dashes in the plan file --> FIXED (Josh's no-em-dash rule)
- [NIT] plan said served version parsed from `"artifact"`, code parses `"version"` --> FIXED

#### Iteration 2 — 1 WARNING, 2 NITs
- [WARNING] greedy `sed` version parse matched the LAST `"version"` key on a line (a nested key would protect the wrong release) --> FIXED (first-match `grep -o | head -1`; arm 4c)
- [NIT] trailing `--dist`/`--keep` with no value aborted under set -e before the diagnostic --> FIXED
- [NIT] post-check comment overstated coverage --> FIXED

#### Iteration 3 — 1 BLOCKER, 1 WARNING, 2 NITs
- [BLOCKER] `--keep 08`/`09` parsed as invalid OCTAL, masked under set -e, emptied the keep window and pruned all-but-served while reporting success (dist versions are zero-padded, so `--keep 08` is natural) --> FIXED (`KEEP=$((10#$KEEP))`; arm 11)
- [WARNING] served protection reconstructed the filename from the version STRING, ignoring the `artifact` name; a version-vs-filename format skew would prune the served release --> FIXED (also protect the artifact-filename-derived version; arm 12)
- [NIT] RETAINED counted a phantom served token --> FIXED (count only discovered kept versions)
- [NIT] backstop did not check `.manifest.json` --> FIXED

#### Iteration 4 — 2 WARNINGs, 2 NITs
- [WARNING] the version parse aborted silently under set -e + pipefail when `latest.json` lacked the `version` key, before the friendly refusal --> FIXED (`|| true`; arm 13)
- [WARNING] same for a missing `artifact` key, silently making the documented-optional field mandatory --> FIXED (`|| true`; arm 14)
- [NIT] `rm -f` counted a silently-failed unlink toward the reclaim --> FIXED (post-rm `[ -e ]` check, exit 4)
- [NIT] no test for the field-absent shapes --> FIXED

#### Iteration 5 — 2 WARNINGs
- [WARNING] the version-string served protection had NO red-capable test after iteration 3 added artifact protection: every served-outside-window arm also carried a matching artifact field, so the artifact path MASKED the version-string path --> FIXED (arm 15: version-only latest.json, proven to be the sole arm that reds when the version-string protection is removed)
- [WARNING] the "either alone is safe" comment overstated the guarantee --> FIXED (reworded to the precise OR condition; named the one unreachable compound shape)

#### Iteration 6 — 1 WARNING, 1 NIT
- [WARNING] the post-prune backstop false-tripped ("this is a bug; report it", exit 3) when a KEPT version was ALREADY missing a sidecar before the run (a pre-existing malformed dist), on an otherwise-correct prune --> FIXED (pre-prune snapshot; only files present before must survive; arm 16)
- [NIT] the documented unreachable compound shape (skewed version AND absent artifact) --> DEFERRED (documented; not producible by the real pointer writer)

#### Iteration 7 — 1 WARNING
- [WARNING] `--keep` had no upper bound; a ~20-digit value overflowed signed 64-bit `$((10#$KEEP))` and WRAPPED to a small window, pruning instead of keeping all --> FIXED (clamp any `--keep` beyond 7 digits to 1000000 before normalization, checked by string length; arm 17)

#### Iteration 8 — CONVERGED
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] the tool does not prune the Windows `kosmos-<V>-win-x64` family (arm64-only glob) --> DEFERRED: explicit, documented scope boundary; safe direction (never over-deletes). Follow-up filed as kosmos#2112.
Four STRENGTHs independently confirmed: whitelist deletion structurally airtight, served protection double-layered and fail-safe (a malformed served token can only OVER-protect), false-success guarded on both axes, and the 44-arm suite genuinely red-capable.

### Outstanding questions (ASKED, still unresolved)
None.

### Deferred (all NITs, none a defect in this card)
- The documented unreachable skewed-version-AND-absent-artifact shape (iter 6).
- The Windows `win-x64` retention family --> kosmos#2112 (iter 8).
- The two pre-existing deploy-site NITs were a DIFFERENT card (#2014), not this one.

### Strengths (across iterations)
- Deletion is a positive whitelist keyed on `kosmos-[0-9]*-arm64.tar.gz` + charset-validated
  tokens: aliases, pkg, tmux, win-x64, and `latest*.json` are structurally unreachable by `rm`,
  not blacklisted. No input constructed across 8 rounds could delete a protected file.
- Served protection is double-layered (version field + artifact filename) and additive-only,
  so no `latest.json` content can cause a deletion.
- False-success is guarded both ways: `rm -f` silent-failure (exit 4) and a pre-prune snapshot
  backstop (exit 3) that does not blame a pre-existing malformed dist.
- Built for macOS `/bin/bash` 3.2.57 (no associative arrays); every fix carries a red-capable
  test arm, verified to red under the specific bug it targets.

### Validation
`bash tools/test-dist-retention.sh` -- 44 arms, all pass on `/bin/bash` 3.2.57. Wired into
`package.json` `test:shell` (`bash -n tools/dist-retention.sh && bash tools/test-dist-retention.sh`).
Real-dist dry run: served 0.6.28 protected, keep 12, 8 prune candidates, deletes nothing.
Branch rebased onto origin/main (clean) before this proof.
