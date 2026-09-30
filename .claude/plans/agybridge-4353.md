# agybridge-4353: the board-start Antigravity hook refresh has never run (kosmos#4353)

## Defect, measured in the served build
`engine/agyrefresh.js` (kosmos#4353, merged 09-28 as #4397) writes Kosmos's report hook for every
Antigravity agent already running when the board starts. Its production wiring, `refreshAtBoardStart`,
calls `create.agyBridgePath()`. `create.js` defines that function and never exported it.

- In the 0.7.11 tarball that production serves (sha256 9dedd82b..., cut at eaab65dad):
  `typeof require('./engine/create').agyBridgePath` is `undefined`; the other four create functions the
  wiring calls are functions.
- So the refresh throws `create.agyBridgePath is not a function` at EVERY board start on a Mac or Linux
  install, before it looks at a single agent. `server.js` catches it and writes one stderr line
  ("agy hook refresh failed: ..."), which is on Mortals' board.log from 09-29 19:28.
- The same is true at the merge commit (527fa600a) and on main today: it has never worked in any build
  (0.7.07 to 0.7.11). Agents launched before #4106 still show "Can't tell".

## Why twelve tests did not see it
Every test of the refresh hands in all of its dependencies, the bridge path among them. None runs
`refreshAtBoardStart`'s own wiring, so the one line that was wrong was the one line no test executed.
The card was then parked "needs-release" on the strength of those tests and the merge.

## Change
- `engine/create.js`: export `agyBridgePath`.
- `engine/agyrefresh.js`: the production wiring is its own function, `productionDeps()`, so a test can
  build it; `refreshAtBoardStart` runs the refresh with it. `existingLaunchDir` returns no folder for a
  running agent whose launch folder is gone, so the hook writer (which makes the folders above its file)
  is never handed one.
- `engine/agyrefresh.test.js`: one test BUILDS the production wiring and runs the parts of it that ask
  launchd nothing (`workdir`, `hasHook`, `hadToolHooks`, `bridgeExists`), then reads which `create.*` and
  `agyhooks.*` names the file uses and asks those modules for each. A second test covers the gone folder
  with the real hook writer.

## Controls (each on a scratch copy of `engine/`)
- Export removed: the wiring test is red with `TypeError: create.agyBridgePath is not a function`, the
  error production logs.
- Folder guard removed: the gone-folder test is red.
- The copy has no server.js, so the call-site test is red in both arms for that reason; it is not counted.

## Decisions
- CALL: build the real wiring in a test, and do not call `names` or `job` there. REJECTED: calling
  `refreshAtBoardStart` under the test's sandbox env; `create.runningJobs` asks launchd, and the sandbox
  does not fence that. WEAKEST PREMISE: the two closures not run are covered only by the name scan, which
  sees `create.name` and `agyhooks.name` and no other spelling.
- NOT DONE here: proving the heal on a real Antigravity agent that predates #4106. That needs such an agent
  and a release carrying this; it is what the card's "needs-release" should have waited for.

## Review iteration 1 (sonnet): 2 WARNINGs, 3 NITs
The reviewer walked the rest of the routine against the real create, agyhooks and allowance functions
(it has never run in a real install) and found it matches them: a Set from runningJobs, the runner word,
the plist argument, the bundled node, ensureHooks's signature, the call site's dry-run guard and catch.
- W (fixed): a running agent whose launch folder was deleted or moved would get that folder made again,
  empty, because ensureHooks creates the folders above the file it writes. The wiring now returns no
  folder for one that is not there, and the refresh reports "no working folder". Test, with a control.
- W (fixed): the first version of the new test scanned only `create.name(` calls, and scanned comments
  too. The wiring is now `productionDeps()`, which the test BUILDS for real (the line that threw runs in
  the test), and the scan strips comments, pins the exact set of create functions, and covers agyhooks
  and allowance.
- NIT fixed: "thirteen tests" counted the new one; it was twelve.
- Controls, each on a scratch copy of `engine/` (so one more test is red in BOTH arms for a harness reason:
  the copy has no server.js for the call-site test to read. It is not counted):
  A. export removed: the wiring test is red with `TypeError: create.agyBridgePath is not a function`,
     the error production logs.
  B. folder guard removed: the gone-folder test is red.
  In the worktree itself: 14 pass.

## Review iteration 2 (opus): 1 WARNING, 2 CONVENTIONs, 6 NITs
- W (fixed): the folder guard was tested only through a fake, so putting `launchDir` back in the
  production wiring reddened nothing, the same shape as the original defect. The wiring test now calls
  `productionDeps().workdir`, `.hasHook` and `.hadToolHooks` for real.
- CONVENTIONs fixed: the header said "Never throws", which is true of the refresh and not of building
  its wiring; this plan's top part described the first design.
- NITs taken: the gone-folder test uses the real hook writer, so its "not made again" can fail; a
  self-comparing assertion removed; the scan's comment says what it does not see; release numbers taken
  out of code comments.
- NITs not taken: a trailing `//` comment would be read by the scan (the pinned list turns that red); a
  regular FILE at the launch path passes the existence check (the writer then refuses it).

## Review iteration 3 (fable): no BLOCKER, WARNING or CONVENTION. Converged.
The reviewer traced the wiring test's real calls through create.js and confirmed they only read, inside the
test's sandbox (plist under AGENT_WORKFORCE_LAUNCH, profile under AGENT_WORKFORCE_DATA), and that the
gone-folder test fails on the disk without the guard.
- NITs not taken: `job` does not ask launchd (only `names` does), so it could be run for real in the test
  too; a trailing `//` comment would be read by the scan; a regular file at the launch path passes the
  existence check and then gets one "could not read" line per board start.
- Reviewer models: sonnet, opus, fable.
- Owed before the proof: the queued full suite on this head.
