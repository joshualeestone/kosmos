---
pre_challenge: true
method: challenge-loop
branch: world-switch-agents-1704
diff_hash: d43a950859228cd79ac3cdc63f59396ca15be14e1ec2761236a9ae986e19d62b
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T03:30:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, alternating opus and sonnet.
**Converged:** Yes. Round 4 (sonnet) found nothing new beyond one NIT, which is
fixed.
**Fixed:** every finding from rounds 1-3 (7 bugs, 2 test gaps, 3 nits).
**Asked (awaiting user):** 0 about the code. The Windows live check of pause and
keep needs Josh's box. The Mac launchctl arm needs Angel's live Mac.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/world-switch-agents-1704-pre-challenge.md'`, computed with node
over git's own output (125,168 bytes as of `b7125fce`; it was 119,564 at the loop's
convergence), after rebasing onto origin/main
`a184f039`. That main includes #2874, Angel's Mac identity slice. The last
commit (35558396) restates the named-world pause-skip comment against today's
code, now that #2874 makes Mac identity world-keyed; the behaviour is unchanged
and the tests are 43/43. The
pre-challenge-gate hook is not installed on this Windows box, so the recipe is
written out here.

**Validation of record:**
- After the rebase, on the Windows box: worldstarts, the switch route, the web
  test, engine.reachable, one-derivation, worldenv-order and platform-gate-wiring
  are 53/53.
- The builder ran the full suite on the Windows box at every round (6279 tests).
  821 fail, identical by name to main's 821 (Mac/tmux assumptions). No failure is
  unique to either side.
- macOS CI is the gate. Playwright is not installed on this box, so CI runs the
  browser checks.

**Control runs:** the builder reverted each fix in turn:
- 16 breakages in the first build;
- 7 in round 1;
- 1 in round 2;
- 5 in round 3.

Each turned its test red.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- A Mac pause from a named Kosmos stopped Kosmos 1's agents for good. The pause
  is now skipped while `namedWorldSpawnRefusal` refuses.
- `ours:false` fleet jobs were paused. They are now left alone.
- The resume used fail-open `isRemoved`. It now uses `removedNames()`.
- Already-disabled jobs were revived. They are now skipped.
- The switch-back resume had no route test; one was added.
- Two comments were corrected.

#### Iteration 2 (sonnet)
A held-for-retry entry was fast-pathed as already paused. Held entries now get a
fresh stop, and `because` is cleared or restored by the outcome.

#### Iteration 3 (opus)
- A held entry was dropped when its fresh disable failed. It is now restored.
- The rollback resumed an earlier switch's pause. It now covers only
  `stoppedNow`.
- The R2 test had no Windows arm; one was added.
- A named Kosmos with an unreadable roster was silent. It now returns 503.

#### Iteration 4 (sonnet)
**NO NEW FINDINGS** beyond an inverted assertion message, which is fixed.

#### After convergence: the macOS CI browser check (`b7125fce`)

`render-worldswitch-2238` scenario J failed twice on CI: a "reopened" dialog still
held the earlier choice. Root cause:
- The browser check's "reopen" clicked the row that the first confirm had just made
  current, which is not clickable, so the dialog never reopened.
- The page itself reset on open.

Fix:
- The check now resets the registry before reopening (as scenarios G and H do) and
  asserts that the dialog is really visible.
- One `worldswResetAgentsChoice()` now runs on open, Cancel and Restart, so even a
  hidden dialog never holds an answer.
- Two node web tests are red without the resets.
- Local results: the web and switch suites are 65/65. CI is the real signal for the
  browser check.
- A focused review of this delta (sonnet) found **NO NEW FINDINGS**. It confirmed
  the diagnosis. `worldswSwitchGo` captures `agents` into the POST body before the
  reset, and no error path re-shows the modal. The "exactly three places" test
  guards the invariant (27/27).
