# kosmos#8928 slice 2: at an agent's launch, end its own browser servers whose session is gone

## Finished looks like
When an agent (re)launches, any Playwright MCP server still running from that SAME agent's earlier session, whose parent (the Claude session that started it) has exited, is ended. On a Mac and on Windows. Nothing else is ever touched: not another agent's server, not a server whose session is alive, not anything that merely resembles one.

## Depends on
Slice 1 (each server's `--output-dir` names its agent: `<tmp>/kosmos-agent-browser/<key>`).

## Match rule (all three, exact)
1. The command line contains this install's `cli.js` path (cliPath()).
2. It contains `--output-dir` followed by EXACTLY outputDir(agent) (whole argument, not a prefix: `mona` must not match `mona-lisa`).
3. Its parent is gone: Mac, ppid 1 (reparented to launchd) or a ppid that no longer exists; Windows, ParentProcessId not alive (win32orphan.pidState === 'gone'; 'unknown' counts as alive, never kill on doubt).

## Ending
Exact pids only (never pkill/pattern), force: an orphaned server serves no one, and one that outlived its session is likely hung, so SIGTERM may do nothing. Mac: its descendants deepest first, then the server, SIGKILL, each pid re-read just before it is ended and skipped unless it is still what was selected. Windows: one listing with creation times plans it (descendants created after their parent, then the server; never a tree kill: Windows keeps a dead parent's pid and reuses pids); one PowerShell (WIN_END, plan on stdin) re-reads each planned pid and Stop-Process -Force only if its creation time and command line still match exactly.

## Where
`endOrphanedServers(agent, deps)` in engine/agentbrowser.js, called from launchConfig when an agent is named; never throws. Mac: inline (ps takes milliseconds). Windows: asynchronous, after the launch has gone ahead, without blocking the supervisor. Fails closed: with no ender handed in it acts only when its caller says `live` (the shim run as a program; the Windows supervisor called with no deps), never in a test run. Each process ended is appended to playwright-mcp/ended-servers.log. Listing, re-check and ending are injectable.

## Tests
- Pure selection over a fixture process table: own orphan selected; own server with a live parent NOT; another agent's orphan NOT; a prefix-named agent (`mona` vs `mona-lisa`) NOT; a non-Playwright process with the same folder NOT; a different install's cli.js NOT.
- Mac end to end with a real throwaway child: spawn a stand-in "server" whose argv matches, orphan it (parent exits), launch the shim for that agent, assert the stand-in is gone; CONTROL: a stand-in with a live parent survives; a stand-in for another agent survives.
- Windows: selection, ordering and the creation-time rule through the seam; what WIN_END compares, and that PowerShell receives each script exactly (-EncodedCommand round trip). WIN_END itself runs only on Windows.

## Weakest premise
That ppid 1 / a dead parent means the session is over. A server deliberately detached by a live session would be ended at that agent's next launch; nothing in Kosmos detaches them today.

## Not in this slice
Servers left by an earlier pinned version (another cli.js path) are not matched. Slice 3 (`kosmos browser stop`), and removing deleted agents' per-agent files and output folders.

## Evidence (first build)
- run-tests --only agentbrowser.test.js + win32supervisor.test.js: 103/103. No stand-in process left after the run.
- Table test: of 10 processes, only own-orphaned ones (ppid 1, a dead parent, and a quoted Windows-style command line) are selected; a live parent, another agent, a prefix-named agent (mona vs mona-lisa), another install's cli.js, a non-server, the shared folder and this process are left. With no way to tell a parent is gone, nothing is selected.
- Mac end to end with real processes: the agent's own orphaned stand-in is ended at its launch; a stand-in with a live parent and another agent's orphan survive.
- Mutations, each red: the call removed from launchConfig (own orphan survives); parentGone always true (the live-parented control is ended).
- Found while proving the control: liveness by kill(pid, 0) called the ended child alive (a zombie until reaped), so the live-parent control could not fail. It now reads ps state. Same trap as the handoff's note on zombies under spawnSync.

## Challenge loop iteration 1 (sonnet)
- Fixed: SIGTERM only, which a hung server (the kind that outlives its session) can ignore. Now SIGKILL, browser children first (Mac), taskkill /T /F (Windows).
- Fixed: a pid reused between the listing and the kill. Each pid is re-read just before it is ended and skipped unless it still matches (the server) or still has the same parent (a child).
- Fixed: on Windows the PowerShell listing sat in front of every launch. It now runs after the launch has gone ahead.
- Fixed: ps -ww, so a COLUMNS in the environment cannot cut the command and quietly defeat the match.
- Fixed: the test's cleanup killed every process whose command named its marker. My own tool shell named it (in a grep), and the cleanup killed it, twice. It now signals only pids the test recorded (and their children), and only while each still starts with this node binary and names the stand-in.
- Fixed: the guard's test could not fail (a throwing listing was caught either way); it now records whether the listing was asked for at all.
- Deferred, decided: the live-execution gate (#1598) opens only in the board's own process; the Mac shim and the Windows supervisor never open it, so using it would switch this off where it must run. Its intent is kept instead: inside a node --test process nothing is signalled unless an ender is handed in.
- Mutations, each red: the re-check skipped; children not ended; every parent counted gone; the test-process guard removed.

## Challenge loop iteration 2 (opus)
- Fixed: Windows `taskkill /T` could reach an unrelated process (a dead parent's pid stays on its children and pids are reused). Descendants now count only if created after their parent, and each pid is ended alone (no /T). Removing the creation-time rule turns the Windows test red.
- Fixed: the Windows run blocked the supervisor (execFileSync in a setImmediate). It is now async throughout (execP), and launchConfig never waits on it.
- Fixed: nothing tested that launchConfig calls the sweep; a launchConfig arm now does (removing the call turns it red). launchConfig passes its own platform; `orphans.platform` can override it, a test seam only (that arm uses it).
- Fixed: a Windows arm: one listing, each pid alone, the older process under a reused parent pid spared, a live parent leaves everything.
- Fixed: every ended process is logged (time, agent, pid, command) to playwright-mcp/ended-servers.log, so a wrong one could be traced.
- Fixed: the cli.js is matched as a whole argument, like --output-dir.
- Changed (repo CLAUDE.md rule 3): the fail-closed gate is kept. The process-wide live-execution switch is not opened in the shim or the Windows supervisor (it would arm store.js and other gated modules there, a change I cannot measure on Windows). Instead a narrow opt-in for this feature: `live` passed only from the shim's require.main path and the Windows supervisor's require.main entry; anything else (every test, any other caller) fails closed, and (added in iteration 3) a node --test process never acts even when told live.
- Noted: servers from an earlier pinned version are not matched (the safe direction).

## Challenge loop iteration 3 (sonnet)
- Fixed: iteration 2's notes claimed a test-process check that the code did not have. Added: a node --test process never acts, even with live; removing it turns its test red.
- Fixed: the Windows listing's line shape is now tested (UTC creation time, quoted paths with spaces, a process with no time), and a failed listing is logged, so a dead feature on Windows leaves a line in ended-servers.log.
- Fixed: the Mac sweep has a 2 s budget (ps timeout 2 s), so a slow ps cannot hold a launch for long.
- Fixed: the header now says what Windows does NOT do: one listing is its only read (no per-pid re-read); its guards are the creation-time rule, the server's live parent, and ending each pid alone. It also says a browser whose server already died is not matched.
- Fixed: the log rotates past 1 MB.
- Deferred: browsers whose server already died (nothing names their agent; the safe direction). Windows per-pid re-reads (a PowerShell start each).

## Challenge loop iteration 4 (opus)
- Fixed (BLOCKER): on Windows the kill acted on a listing up to 15 s old, while the orphan may be exiting by itself, so a reused pid could be ended. Now ONE PowerShell (WIN_END) re-reads each planned pid and ends it only if its creation time and whole command line still equal the listing's; a pid with no creation time is left. The test pins what WIN_END compares (it runs only on Windows, so this is the weakest-tested part: Homer's box is where it can be measured).
- Fixed: never acts in a test run by the store's rule (--test, an inherited NODE_TEST_CONTEXT, run-tests.sh's KOSMOS_TEST_RUN), not only --test.
- Fixed: the Mac wiring is tested: the shim, spawned as a program with this run's markers removed, ends the agent's own orphan and spares another agent's; setting its live to false turns it red.
- Fixed: the Mac budget covers the whole sweep (listing included), each ps timed to what is left.
- Fixed: repo CLAUDE.md rule 3 now records this exception and why.
- Fixed: a Windows row's creation time must look like one; the stand-in's cli.js restore is registered before it is replaced.

## Challenge loop iteration 5 (sonnet)
- No new finding about what is ended. Windows robustness, since this code has never run on Windows: both scripts now go as -EncodedCommand (no Node-to-PowerShell quoting can break them; a test decodes the argument back to the exact script); the plan goes on stdin (no 32K environment limit); output is UTF-8 (non-English names and temp paths still match); times use the invariant culture; the identity compare is case-sensitive (-cne); a failed end is logged, as a failed listing already was.
- Plan spec sections brought up to date with the code (they still described taskkill).

## Challenge loop iteration 6 (opus)
- Fixed (BLOCKER): the Windows half never ran in production. Tasks start the anchored boot shim (win32anchor.BOOT_JS), which calls `main(args)` with no deps, so the `require.main` opt-in never applied. Now `main()` called with no deps is a real start (endOrphansFor): that covers shims already on disk, with no re-anchoring. Every test passes deps; the sweep refuses in a test run regardless. Tested, and BOOT_JS's call shape is pinned; making it require endOrphans turns the test red.
- Fixed: runPs decodes stdout as one UTF-8 stream (a character split across chunks stayed broken), and PowerShell writes UTF-8 without a byte-order mark (stripped anyway), so the first `ended` line is never missed in the log.
- Fixed: cli.js must be the interpreter's script argument, not named anywhere; an orphaned `tail` on the same paths is not a match (loosening it turns the test red).
- Fixed: on Windows a "parent" created after the server holds a reused pid, so the server counts as orphaned (removing the rule turns the test red; a parent older than the server is the control).
- Changed: the opt-in is `live` only; the process-wide live-execution switch no longer arms it, so the board process can never run a blocking sweep.

## Challenge loop iteration 7 (sonnet)
- No finding of a process ended wrongly. Taken: PowerShell by full path; the encoding setters guarded; a log line when a plan ends nothing; the plan logged before the ender runs; the interpreter matched as any path ending in node/node.exe (a Mac ps prints a path with spaces unquoted, which the earlier pattern missed: now a table case); no sweep when the agent had no earlier session (its output folder did not exist), so most Windows launches start no PowerShell (control tested).
- Recorded honestly in CLAUDE.md: on Windows the opt-in is on for a deps-less call; its guard there is the test-run check.
- Deferred, needs Windows: whether Claude on Windows starts the MCP server through an intermediate process that exits (then a live session's server would look orphaned). Only that agent's own server could be affected; Homer's box can measure the parent chain.
