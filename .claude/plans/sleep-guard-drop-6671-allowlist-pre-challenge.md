---
pre_challenge: true
method: challenge-loop
branch: sleep-guard-drop-6671-allowlist
diff_hash: 6b25de61c12e388d39221e28e4348c4458ae9b64a8f0ab8b83cd2bdc66e69486
validation: passed
subdir_audit: passed
iterations: 1
converged: true
generated_at: 2026-11-01T14:19:11Z
---

# Challenge-loop proof: sleep-guard-drop-6671-allowlist

Addresses #6710 (the guard's owning card). The change removes the two stale `#6671` allowlist
entries from `tools/test-sleep-control-guard-6710.sh`, which the guard's own ALLOWLIST comment
assigned to Kano once `leakctl-6671` merged (it has: commit `4f319bf57d`, #6813; #6671 CLOSED).

## Validation

- Full Node suite green on a quiet box: `shell-shard 4/4: all 77 passed`,
  `test:shell ran as 4 shards at once in 857 s; all green (#7100)`,
  `validation PASSED for stack=typescript hash=6b25de61c12e`, `VRC=0`. Verdict line present (not a
  killed-suite tally). Box was release-free and `heavy-gate: CLEAR` before the run.
- `subdir_audit: passed`. The directly-affected artifact is the guard itself; run standalone it
  reports `scanned 177 non-allowlisted test-*.sh, 177 clean` and `all sleep-control-guard checks
  passed` (exit 0), with the two formerly-exempt files now in the scanned set.
- Conflict prediction clean: `git merge-tree --write-tree HEAD origin/main` exits 0 against current
  main (`8f2b6be756`); merge-base `a792495f51` is stable, so the three-dot diff_hash holds.

## Iteration 1 ledger — reviewer model: Sonnet (blind)

- Self-generated findings: none.
- Zero [BLOCKER] / [WARNING] / [CONVENTION]. The reviewer independently verified, by content and
  not merely by ancestry, that `4f319bf57d` (leakctl-6671) is an ancestor of origin/main and that
  both files' outside controls are no longer `sleep`; that `ALLOWLIST=""` is handled safely by
  `allowlisted()` (empty heredoc line, `[ -n "$tok" ]` guard), by the stale-entry self-check
  (`[ -n "$alb" ] || continue`), and by the "#6710's four files" check; and that the matcher, scan
  and self-checks are untouched so there is no unintended behavior change.
- [NIT] `tools/test-sleep-control-guard-6710.sh:16` header still says an uncovered control needs
  the opt-out or an allowlist entry, still accurate with an empty list; no owner recorded for
  future entries. Reviewer-judged intentional and fine. No change.
- [NIT] `tools/test-test-leak-guard-4273.sh:299` a residual `sleep 5` inside an escaped `bash -c`
  string is deliberately skipped by the matcher (the quoted-shape case noted at the guard's lines
  133-134); scan still passes, not a regression. No change.
- [STRENGTH] diff minimal; plan file matches the diff; coverage is restored on the two files.

## Convergence

Iteration 1 (Sonnet) produced zero NEW actionable findings after dedup and no unresolved ASKED
findings -> `6d CONVERGED` at iteration 1. Per the loop, a single clean blind pass converges; no
confirming pass is run. The two NITs are recorded above as reviewer-judged non-issues; neither
blocks.
