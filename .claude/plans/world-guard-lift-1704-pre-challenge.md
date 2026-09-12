---
pre_challenge: true
method: challenge-loop
branch: world-guard-lift-1704
diff_hash: c06c17b347256d67bffbfef55173fa174ebeed0679dca85b669fa32fb3e8750d
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T08:30:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2, alternating opus and sonnet.
**Converged:** Yes. Round 2 (sonnet) found NO NEW FINDINGS. It recorded one
judgment-call test gap (no Windows team test), named in the plan and the PR, and
one NIT that follows an existing pattern.
**Fixed:** every round-1 finding (3 bugs, 1 test gap, 1 nit), plus a Windows roster
gap found while fixing.
**Asked (awaiting user):** 0 about the code.
- Renet, who wrote #2849, cleared the lift through Splinter on three conditions.
  All three are confirmed in the plan's "Renet's conditions".
- `engine/remove.js` and `engine/status.js` are flagged for Angel's review (her
  Mac lane).

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/world-guard-lift-1704-pre-challenge.md'`, computed with node over
git's own output. It was taken at `b3e082aa` (111,939 bytes), after rebasing onto
origin/main `2ae3fbd9`, which includes #2877, #2879 and #2885. The
pre-challenge-gate hook is not installed on this Windows box, so the recipe is
written out here.

**Validation of record:**
- **Full suite on the Windows box at `ce1349b2`** (on main `136172a7`): the branch
  is 6,379 tests, 5,550 pass and 822 fail; main is 6,361 tests, 5,532 pass and 822
  fail. The failing-name lists are identical (820 names, some repeated). The
  branch's 18 extra tests are new and all pass.
- **After the rebase onto `2ae3fbd9`:** the core suites (20 files: the lift,
  offline rows, worldstarts, switch, 2827, one-derivation, the inventories, the
  world-identity suites, outbox, win32roster, and #2885's socket-split and
  dm-badge) are 193 tests. 190 pass and 3 fail. The 3 are
  `server.socket-split.test.js`'s #668 offline-row tests, which fail identically
  on a clean main `2ae3fbd9` worktree.
- macOS CI is the gate.

**Control runs** (each reverted, run, then restored):
- main's `server.js`: 9 red;
- main's `worldstarts.js`: 2 red;
- `launchKey` returning the bare name: 12 red;
- (a) the legacy fence: 2 red;
- (b) the raw-key probes: 4 red;
- (c) crafted names: 1 red;
- (d) the live join ignoring this world's record: 1 red;
- (e) Windows rows back through the key filter: 2 red;
- Renet's condition 2, with `currentWorldId` reading the active world: 10 of 12 red.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BUG] (a) A named Kosmos's Remove and Restore reached Kosmos 1's legacy
  `com.<name>.discord` job, proven by a probe. `remove.jobFor` now offers it in
  Kosmos 1 only.
- [BUG] (b) Both offline-row lookups compared launch keys to bare names.
  `create.disabledJobs` and `create.runningJobs` now answer in this Kosmos's names,
  through `launchidentity.nameInWorld`.
- [BUG, low] (c) A crafted `<name>+<world>` reached another Kosmos's agent.
  `remove.unsafeToActOn` now refuses the separator.
- [TEST-GAP] The Windows session end was stubbed. The test now uses two live `ava`
  sessions from two worlds.
- [NIT] A plan contradiction was fixed.
- Found while fixing: a named Kosmos's Windows roster was empty. Fixed in
  `status.parsePanes`.
- Also in this round: Renet's conditions (2) and (3) got tests on both arms.

#### Iteration 2 (sonnet)
**NO NEW FINDINGS.** It confirmed:
- the Windows roster sources are scoped to this world;
- no spawn module reads `activeWorldId`;
- the removed routes are exactly the five that #2849 guarded;
- no `unsafeToActOn` caller passes a launch key;
- the list shapes are unchanged for every caller.
