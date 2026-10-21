---
pre_challenge: true
method: challenge-loop
branch: tmuxisolate-6852
diff_hash: 5383a5d6d35434fd94bd1c9fd93ff922527660c1df4250c5a39cbc003b1bb8f7
validation: passed
subdir_audit: passed
timestamp: 2026-10-21T19:14:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind reviews; models alternated sonnet, then opus)
**Converged:** Yes (iteration 2, opus, zero actionable findings)
**Total findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, several NITs
**Fixed:** the WARNING + 2 NITs | **Deferred:** 0

Related to #6851 (the Agent1s default-tmux-server-death incident); Addresses #6852 (this hardening
card). Test-only shell change in `tools/test-linux-systemd-live-4918.sh`, a Linux systemd + tmux
LIVE test that runs only in CI.

### Validation

The live test runs only in CI (a real systemd + tmux Linux box); `tools/run-tests.sh` does not
execute it, so the appropriate local validation for this shell change is `bash -n` (passed), which
PM Liu Kang scoped explicitly (m6381: "say how you checked it, bash -n plus what the change does").
shellcheck is not installed on this box. The box was reserved for the 0.7.62 release during this
work, so the full heavy suite was not run here; it will run on the exact head as part of the merge
gate after the 0.7.62 lift (this PR is built and opened now but held from merge by that cut).

### Per-Iteration Breakdown

#### Iteration 1 — Reviewer model: sonnet
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NITs
- [WARNING] cleanup() rm -rf's TMPDIR_ROOT but ran no final kill-server, so an early-exit/signal
  before the two kill-server lines could orphan the private server --> FIXED (cleanup() now runs a
  kill-server on the private server before rm -rf; safe because the server is private).
- [NIT] comment "measured on Mortals" (machine name) --> FIXED (reworded to "see the #6851 audit").
- [NIT] two pointer comments restate the top block --> kept (two distant kill-server sites).
- [NIT] socket path length under a very long $TMPDIR --> fine in CI (/tmp), noted.
**Self-generated:** n/a (first pass)

#### Iteration 2 — Reviewer model: opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NITs
- [NIT] hard-coded cross-file line `engine/linuxjob.js:285` could drift --> FIXED (symbol ref to
  `linuxjob.unitFor` instead).
- [NIT] "changes nothing there" slightly imprecise (CI does move the server to a private socket; the
  test OUTCOME is unchanged) --> FIXED (reworded to "the test outcome is unchanged there").
- [NIT] cleanup's bare `tmux kill-session` vs `"$TMUX_BIN"` elsewhere (pre-existing, safe) --> left
  (pre-existing lines not in scope; both honor the exported TMUX_TMPDIR + unset TMUX).
**Converged** — no actionable findings. Reviewer confirmed placement, `$TMUX_BIN` set in the EXIT
trap under `set -u`, the end-to-end match via `linuxjob.unitFor` propagation, and `bash -n` passes.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | test-linux-systemd-live-4918.sh (cleanup) | BRANCH | no final kill-server on early exit could orphan the private server | FIXED | cleanup() kill-server before rm -rf |
| 2 | 1 | NIT | comment | SELF | "measured on Mortals" | FIXED | reworded |
| 3 | 2 | NIT | comment | SELF | hard-coded linuxjob.js:285 line number | FIXED | symbol reference |

### NITs (non-blocking)
- cleanup's bare `tmux kill-session` vs `"$TMUX_BIN"` (pre-existing, safe) — left.
- socket path length under an unusually long $TMPDIR — fine in CI.

### Strengths
- Isolation block placed before every agent creation and every tmux call, including the EXIT trap (iters 1, 2).
- End-to-end match: `linuxjob.unitFor` propagates TMUX_TMPDIR into each agent's unit, so systemd agents and the test's bare has-session checks share the private server (iters 1, 2).
- `$TMUX_BIN` guaranteed set in cleanup; `unset TMUX TMUX_PANE` safe under `set -u`; `bash -n` passes (iter 2).
