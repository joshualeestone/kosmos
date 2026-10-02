---
pre_challenge: true
method: challenge-loop
branch: tmuxsocket-2955
diff_hash: b686fc882704dd166551b41c86cbd0978d793ead3dcacfce49e6a8a1429f53a4
subdir_audit: passed
timestamp: 2026-10-02T03:34:46Z
converged: true
---

## Challenge loop: 19 blind rounds, Opus and Sonnet alternating; round 19 found only NITs

Ledger in `.claude/plans/tmuxsocket-2955.md` (Review rounds, each round's findings and dispositions).

## [BLOCKER] round 1, REPLACED: my first design (a launch-time preference plus a record file) raced the board
Replaced by the runtime rule: whoever meets the version wall reads through the tmux that can LIST the server.

## [BLOCKER] round 5, FIXED: Kosmos's own tmux was never found in an install (tests passed only through seams)
Derived from where status.js is installed, and through engine-path for the supervisor; tests use the real derivations.

## [BLOCKER] round 17, FIXED (measured): a newer tmux cannot ATTACH to an older server
Open in Terminal attaches with a version-matched tmux (attachTmux).

## [WARNING] rounds 2 to 18, FIXED or DOCUMENTED
Switch-back, a miss's one-minute wait, the explicit-choice guard (marker + recorded value + live value), a gone tmux,
the end-of-run check reading the wall as "wall" (never gone), one candidate order, 2 s probes, cached versions; the
decided trade-offs (PATH move, once-per-start supervisors, the unlinked-socket twin) in the plan's weakest premise.

## Measured on private sockets
3.6a lists and drives a 3.5a server; 3.5a against 3.6a says "server exited unexpectedly"; attach needs the same version.

## Related tests
251 test files that read the launcher, the supervisor, the status engine, create.js or terminal.js, one per process:
249 green; cli.busy-health-4466 and server.stray-removable red under load, green alone, untouched by this branch.

## After convergence
Merged origin/main (a conflict in engine.reachable.test.js: both sides added excuses; kept both). The Windows
coupling audit (#1732) flagged process.env.HOME in the detail line; replaced by os.homedir(). Both are mechanical.
