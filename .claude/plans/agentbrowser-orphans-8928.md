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
Exact pids only (never pkill/pattern). Mac: SIGTERM, then SIGKILL after a short wait if still there. Windows: `taskkill /PID <pid> /T /F` through the existing win32stop path, so the browser it started goes too.

## Where
`endOrphanedServers(agent, deps)` in engine/agentbrowser.js, called from launchConfig when an agent is named, before the config is returned; never throws, never delays the launch more than a bounded read (one ps / one CIM query, with a deadline). Process listing and killing are injectable for tests.

## Tests
- Pure selection over a fixture process table: own orphan selected; own server with a live parent NOT; another agent's orphan NOT; a prefix-named agent (`mona` vs `mona-lisa`) NOT; a non-Playwright process with the same folder NOT; a different install's cli.js NOT.
- Mac end to end with a real throwaway child: spawn a stand-in "server" whose argv matches, orphan it (parent exits), launch the shim for that agent, assert the stand-in is gone; CONTROL: a stand-in with a live parent survives; a stand-in for another agent survives.
- Windows: selection and the taskkill call through the seam.

## Weakest premise
That ppid 1 / a dead parent means the session is over. A server deliberately detached by a live session would be ended at that agent's next launch; nothing in Kosmos detaches them today.

## Not in this slice
Slice 3 (`kosmos browser stop`), and removing deleted agents' per-agent files and output folders.

## Evidence (first build)
- run-tests --only agentbrowser.test.js + win32supervisor.test.js: 103/103. No stand-in process left after the run.
- Table test: of 10 processes, only own-orphaned ones (ppid 1, a dead parent, and a quoted Windows-style command line) are selected; a live parent, another agent, a prefix-named agent (mona vs mona-lisa), another install's cli.js, a non-server, the shared folder and this process are left. With no way to tell a parent is gone, nothing is selected.
- Mac end to end with real processes: the agent's own orphaned stand-in is ended at its launch; a stand-in with a live parent and another agent's orphan survive.
- Mutations, each red: the call removed from launchConfig (own orphan survives); parentGone always true (the live-parented control is ended).
- Found while proving the control: liveness by kill(pid, 0) called the ended child alive (a zombie until reaped), so the live-parent control could not fail. It now reads ps state. Same trap as the handoff's note on zombies under spawnSync.
