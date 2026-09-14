---
pre_challenge: true
method: challenge-loop
branch: worlds-boot-sandbox-2628
diff_hash: 76530a31b3a5e14193459c7ac36592c54ceeee3c5aad73417aabee301c2825fb
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T00:10:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet).
**Converged:** Yes. Round 2 found no bug; both of its NITs were addressed (one
comment corrected, one left as is with the reason recorded).
**Fixed:** every round-1 finding, plus a merge-order hazard we found between rounds.
**Asked (awaiting user):** 0.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/worlds-boot-sandbox-2628-pre-challenge.md'`, computed with node
over git's own output (28,115 bytes), after rebasing onto origin/main `eaf23714`.
The pre-challenge-gate hook is not installed on this Windows box, so the recipe is
written out here.

**Validation of record (Windows box):**
- After the rebase: server.world-boot-sandbox-2628, win32board.world-2628,
  win32board, sandbox, named-world-spawn-2827, worldenv-order and engine.reachable
  are 57/57.
- The wider neighbouring run shows only the 13 pre-existing Windows failures
  (connections-refresh-1649, forget-claude-1659, claude-apikey-2420), identical on
  main.
- A combined tree with PR #2845 is 179/180, with only the known
  `worlds.registry-1704` baseline failing.
- macOS CI is the gate.

**Control runs:**
- The new boot test run against unfixed code: the CONTROL passes and the boot test
  FAILS with "the board exited 2 before listening … Kosmos will not start
  half-sandboxed".
- The board-world test's control shows the world env would move the anchor.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BUG] With named worlds bootable, `win32board` derived its machine paths (the
  logon task anchor, claim file and restart log) from the post-world env. Fixed
  with `worldenv.launchEnv()` and `win32board.machineEnv`, and tested.
- [SECURITY, low, pre-existing] The token guard read a different env from the
  boot guard. Both now read `LAUNCH_ENV_OVERRIDES`, and the boot test asserts 403.
- [NIT] "Set AGENT_WORKFORCE_LAUNCH in the test" was declined, because it would
  make the launch itself half-sandboxed. `DRY_RUN=1` was used instead.

#### Between rounds (ours)
The board-world test's control went vacuous with PR #2845's marker-aware
`anchorDir`. The comparisons now strip the marker, and the tests were verified in
both trees.

#### Iteration 2 (sonnet)
No bug. It verified the freeze order (the abandon path included), `machineEnv`
coverage, the capture point and test isolation. NITs:
- `startedByTask` still reads process.env. That is harmless: its key is never a
  world root.
- The restart-helper comment was inaccurate, and is now corrected.
