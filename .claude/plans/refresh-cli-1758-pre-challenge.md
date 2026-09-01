---
pre_challenge: true
method: challenge-loop
branch: refresh-cli-1758
diff_hash: 2a5591a7135cde38058807937b965a29399a3268d4ecb136049000d5d8c9ff88
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T21:04:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (converged on a fully-blind iteration 7 with zero new findings)
**Converged:** Yes
**Total findings:** 5 WARNINGs, 8 NITs, 1 CONVENTION (many were duplicates across
iterations)
**Fixed:** 7 | **Deferred:** 5 | **Asked (awaiting user):** 0

**Validation note:** the canonical `validation_log_run_or_skip` helper mis-detects
this repo's stack as `typescript` and runs `pnpm typecheck`, which the repo does
not have (its `package.json` `type-check` is a no-op: "plain JavaScript, nothing
to type-check"). That is a false failure from the wrong instrument. The repo's
real gate is `yarn test` (`bash tools/run-tests.sh`), which was run green at the
final HEAD (rc=0, "Done in 123.90s", `refresh-local-cli: 0 failures`,
`release-detached: 0 failures`). The subdir-CLAUDE.md audit ran clean (no CLAUDE.md
files changed). `validation: passed` reflects the real gate.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 2 WARNINGs, 3 NITs
- [WARNING] release.sh — step 11 sourced the CLI from the shared checkout
  ($MAIN_REPO), which can be fast-forwarded past $SHA mid-cut --> FIXED (ebb61925):
  source from the frozen $BUILD/install/kosmos the comparator verified.
- [NIT] refresh-local-cli.sh resolve() — unbounded symlink loop --> FIXED (40-hop cap).
- [NIT] refresh-local-cli.sh — exec bit not re-verified after copy --> FIXED.
- [NIT] refresh-local-cli.sh — repo gate compared resolved vs logical path --> FIXED (pwd -P).
- [WARNING] CLI/app-version mismatch awareness --> DEFERRED: pre-existing bin/app
  independent-update architecture, strictly better than the stale-CLI state.

#### Iteration 2
**New:** 1 WARNING, 2 NITs (1 WARNING was a re-find)
- [WARNING] release.sh:946 — post-deploy refusal reds an already-published cut -->
  DEFERRED: by design per the card ("refuses if it cannot"), mirrors step 10.
- [NIT] resolve() relative-broken-symlink misattributes its refusal message -->
  DEFERRED: safe refusal, cosmetic, pathological edge; real install is an absolute symlink.
- [NIT] test refusal arm's chmod 555 is bypassed under root --> FIXED (e999644f):
  root-skip guard; missing-source + cycle arms cover refusal UID-independently.

#### Iteration 3
**New:** 1 NIT
- [NIT] the single-root GUARD_REPO gate would overwrite a tracked install/kosmos in
  a *different worktree* (100+ on this box) --> FIXED (61e89178): also leave alone a
  CLI inside a git worktree. (Superseded/refined in iteration 4.)

#### Iteration 4
**New:** 1 WARNING (1 NIT was a duplicate)
- [WARNING] the iteration-3 "inside any git repo" gate was too broad: it would
  SILENTLY SKIP a genuine stale install that merely lives under a git repo (e.g.
  ~/.local/bin/kosmos under a dotfiles-tracked $HOME), which is the exact pre-#1758
  defect --> FIXED (d965093d): make the gate PRECISE -- leave alone only a repo's
  TRACKED install/kosmos, refresh a real install even under a repo root. Two test
  arms (tracked-source-left-alone; install-under-repo-still-refreshed).

#### Iteration 5
**New:** 1 NIT (1 WARNING + 1 NIT were duplicates of deferred items)
- [NIT] two defensive test paths unexercised: (a) exec-bit refusal, (b) symlinked
  repo-path canonicalization --> (b) FIXED (88e7bf08): arm 6d, proven non-vacuous
  (reverting pwd -P makes it refresh instead of leave-alone). (a) DEFERRED:
  untriggerable hermetically (needs a chmod that fails silently while cp/mv succeed);
  positive exec case covered by arm 1.

#### Iteration 6 (semi-blind: given the deferred list)
**New:** 0. No new issues; positive verification of wiring, hermeticity, set -e,
package.json, conventions.

#### Iteration 7 (fully blind)
**New:** 0. Only a NIT that deduplicates against the deferred post-deploy WARNING
(the reviewer itself called it "correct and intentional, not a defect"). **Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 0 | CONVENTION | .claude/plans/ | no plan file | DEFERRED | small tooling change built directly from card #1758 |
| 2 | 1 | WARNING | release.sh | source from shared checkout not frozen tree | FIXED | ebb61925 |
| 3 | 1 | NIT | refresh-local-cli.sh | unbounded symlink resolver | FIXED | ebb61925 |
| 4 | 1 | NIT | refresh-local-cli.sh | exec bit not re-verified | FIXED | ebb61925 |
| 5 | 1 | NIT | refresh-local-cli.sh | repo gate resolved-vs-logical | FIXED | ebb61925 |
| 6 | 1 | WARNING | refresh-local-cli.sh | CLI/app-version mismatch | DEFERRED | pre-existing arch, strictly better than stale CLI |
| 7 | 2 | WARNING | release.sh:946 | post-deploy refusal reds shipped cut | DEFERRED | by design per card, mirrors step 10 |
| 8 | 2 | NIT | refresh-local-cli.sh resolve() | relative-broken-symlink message | DEFERRED | safe refusal, cosmetic, real install absolute |
| 9 | 2 | NIT | test | chmod 555 bypassed under root | FIXED | e999644f |
| 10 | 3 | NIT | refresh-local-cli.sh | single-root gate skips worktrees | FIXED | 61e89178 (refined in #11) |
| 11 | 4 | WARNING | refresh-local-cli.sh | any-repo gate silently skips real install under repo | FIXED | d965093d (precise tracked-source gate) |
| 12 | 5 | NIT | test | symlinked-repo canonicalization unexercised | FIXED | 88e7bf08 (arm 6d, non-vacuous) |
| 13 | 5 | NIT | test | exec-bit refusal path unexercised | DEFERRED | untriggerable hermetically; positive case covered |

### Real-box demonstration (beyond the hermetic test)

The automated test is hermetic by design (scrubs PATH so CI can never mutate the
real machine) -- it proves the LOGIC. A peer (PigeonPete) correctly noted a
sandbox pass does not show the REAL installed CLI refreshes. Demonstrated on this
Mac: staled the live ~/.local/share/kosmos/bin/kosmos (marker added, 45499 bytes),
ran the real refresh-local-cli.sh (no overrides; source = tree install/kosmos),
result "refreshed the installed CLI at .../bin/kosmos" exit 0, live CLI then 45460
bytes byte-identical to the tree, marker gone, mtime moved, `kosmos --help` shows
the verb list (#1674 fix) and `kosmos status` works. The real box gets refreshed,
not just a sandbox.

### NITs (non-blocking)
- [NIT] resolve() relative-broken-symlink refusal message says "cycle" (iter 2/4/5/7) -- deferred, safe.

### Strengths (across iterations)
- Faithfully mirrors the step-10 sibling (restart-local-board.sh, #360): gated on
  reality, says which case it found, refuses (reds the cut) rather than skipping.
- Sources from the frozen $BUILD so tested == built == served == installed.
- Verify-by-content after the copy on two axes (byte-identity + exec bit), each a named refusal.
- The precise git-tracked-source gate distinguishes a source copy from an install-under-a-repo.
- Hermetic, non-vacuous test with a real negative control and multiple UID-independent refusal arms.
- No em dashes; conventions clean.
