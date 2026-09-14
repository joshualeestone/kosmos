---
pre_challenge: true
method: challenge-loop
branch: world-agents-outbox-1704
diff_hash: ac6305a4979d08be2d046b5398f102e56fe32ac1e61ba16b5fe239f9e799f085
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T05:10:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, alternating opus and sonnet.
**Converged:** Yes. Round 4 (sonnet) found nothing new beyond one NIT, declined
with the reason recorded in the plan's review log.
**Fixed:** every finding from rounds 1-3 (5 bugs, 1 convention/bug, 1 convention,
1 stale-prose item and 4 nits).
**Asked (awaiting user):** 0 about the code. The live check (keep running, open
another Kosmos, reply, switch back) needs PR3 (#2877) merged and Josh's box. The
real Mac curl, bash 3.2 and a live tmux pane are for Angel and macOS CI.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/world-agents-outbox-1704-pre-challenge.md'`, computed with node
over git's own output (158,220 bytes). It is taken after the rebase onto main
`e1e91030`, which carries #2877 (PR3) and #2881; the hash at `a07e8df9`, on main
`f4e97838`, was `18c85d62`. It was taken after rebasing
onto origin/main `f4e97838`, which includes #2874 (Angel's Mac world identity) and
#2878. The pre-challenge-gate hook is not installed on this Windows box, so the
recipe is written out here.

**Validation of record:**
- Focused set, after the rebase, on the Windows box: 28 files, 409 tests. 397 pass
  and 12 fail. The 12 are status.config-dir-1523 (3), status.config-root-guard (5),
  the status.test.js tmux socket test (1) and status.tmux-bin (3), and all 12 also
  fail on main here. This set is outbox, the server, CLI, hook and Windows-CLI
  outbox suites, launchidentity-1704, world-mac-identity-1704, one-derivation,
  engine.reachable, fixture-discipline, server.worldenv-order and every
  status*.test.js.
- Full suite on the Windows box, at `08d79d6d`: 596 files and 6301 tests. 5471
  pass and 823 fail. Compared by name with main's full run:
  - 821 are main's baseline (Mac/tmux assumptions).
  - 1 is a test #2874 added after that baseline run. It also fails on current
    main `f4e97838`, run in a detached worktree.
  - 1 was a REAL branch failure, the `server.agent-token-sender-570` source
    scan of the old inline post route. It was fixed in `a07e8df9` (see the
    plan's review log), and both controls go red.

  Two more names differ only by the worktree path or a renamed test, and also
  fail on main.
- macOS CI is the gate.

**Control runs:** each round's builder reverted its fixes and saw its new tests go
red. Round 3's revert alone turned three tests red.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- A person's own terminal got a false "Kept.". The pane keep now needs a profile.
- A literal U+FEFF was in kosmos-cli.js's BOM strip. It is now built from the code
  point, with an invisible-character scan.
- One drain pass could deliver 500 entries synchronously. It is now capped at 20
  per pass, with continuation.
- A null booted world counted as the default. It now refuses nothing (worldenv's
  rule).
- Dead 421 branches in the Windows CLI were removed.
- The world id had two derivations. It now has one rule, pinned to the shell.

#### Iteration 2 (sonnet)
- Discord-bridged and named-world panes were refused. The keep now names the
  session by the roster rule (`launchidentity.agentNameFromSession`, shared with
  `status.parsePanes`).
- Mac prose predating #2874 was corrected.

#### Iteration 3 (opus)
- A profile-less legacy Discord agent was refused by the keep but accepted by the
  drain. The keep now also accepts a pane the roster ties
  (`launchidentity.paneSessionIsOurs`, shared with `status.isNamedOurs`).
- Two comment nits were fixed.

#### Iteration 4 (sonnet)
**NO NEW FINDINGS** beyond one NIT (`kosmos_curl` needs `mktemp` on every
call). It was declined as the stated tradeoff: one header path, so no call goes
out without its world.

#### After convergence: the full suite (`a07e8df9`)
The full suite found one stale source scan (`server.agent-token-sender-570`) of
the old inline post route. The scan was fixed to pin the route's
`senderFromAgentToken` call and `sendRoomPostAsAgent`'s refusal and pass-through.
Both controls turn it red.

A focused review of that delta (sonnet) found **NO NEW FINDINGS**:
- Behaviour matches main's inline route, down to the order of the answers and the
  exact `because` text.
- The #570 intent holds: a bad token is never swapped for the pane.
- A missing anchor makes the scan fail, never pass vacuously.
- No other scan of the post route is stale.

The test file is 6/6.

#### After Angel's approval: the rebase onto `e1e91030`
#2877 and #2881 landed after Angel approved `41f53206`. There was one conflict, in
server.js's real-start block:
- #2877 added `worldstarts.drainAtBoot(...)` at the same spot where this branch adds
  `startOutboxDrain()`.
- Both are kept, the resume of paused agents first. The two are independent, and
  each is wrapped so neither can stop the other.

After the rebase, the focused set plus #2877's switch suites (33 files: worldstarts,
server.world-switch-agents-1704, web.world-switch-agents-1704,
platform-gate-wiring and server.agent-token-sender-570 added) is 464 tests, with
452 passing. The 12 failures are the same main-baseline set.
