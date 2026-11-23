# kosmos#8928 slice 1: each agent's browser config names the agent

## Finished looks like
Every agent launch that gets a browser config gets its OWN file and its own output folder, both named for the agent, so a Playwright MCP server process names its agent on its command line (`--output-dir .../kosmos-agent-browser/<agent>`). A leftover server can then be traced to its agent (slice 2 ends those whose parent is gone; slice 3 is `kosmos browser stop`). A launch with no agent name keeps today's shared file, so nothing that calls launchConfig() bare changes.

## Change
- engine/agentbrowser.js: `launchConfig({ agent })`. A safe key (see iterations 1 and 2 below: lowercase, cleaned, hashed with `~` when changed); only an empty name falls back to the shared file. `configPath(agent)` = `<home>/agents/<safe>.json`; `outputDir(agent)` = `<tmp>/kosmos-agent-browser/<safe>`.
- engine/agent-browser-config.js: the agent name from argv[2].
- bin/agent-supervisor.sh: pass "$SESSION" to the shim.
- engine/win32supervisor.js:281: pass the agent's name (check which spec field holds it).

## Tests
- unit: two agents get two files and two output folders; a hostile name (`../x`, `a/b`, empty) cannot leave `<home>/agents`; no name keeps the shared path (CONTROL).
- shim: argv name reaches the file name; tools/test-supervisor-agentbrowser-3633.sh asserts `--mcp-config` names the session's file.
- Windows: win32supervisor test injects agentBrowser today; add one that the default passes the name.

## Weakest premise
That the agent name ($SESSION on a Mac, the spec name on Windows) is stable across an agent's relaunches. If it is not, slice 2 cannot match a leftover server to its agent.

## Open
- Old shared mcp-config.json stays on disk after this ships; harmless, nobody reads it once every launch names an agent.
- Disk: one small file per agent, rewritten only when its text changes.

## Evidence (first build)
- run-tests --only engine/agentbrowser.test.js: 34/34. tools/test-supervisor-agentbrowser-3633.sh: passes, including the two new checks (the config is agents/ab-3633.json; its --output-dir names ab-3633).
- Mutations, each red: the supervisor no longer passes "$SESSION" (both new shell checks FAIL); the name sanitizing removed ("../../escape" leaves the agents folder).
- Not tested end to end: the Windows default (win32supervisor passes spec.name); win32supervisor.test.js injects agentBrowser, so the default is not reached there.

## Challenge loop iteration 1 (sonnet)
- Fixed: two agents could share one file (names that clean to the same text, or differ only by case on a case-insensitive disk). The key is now lowercase, at most 48 characters, never ends in a dot, and gets an 8-character hash of the original name whenever cleaning changed it. An ordinary lowercase name (mona-lisa) is used as it is.
- Fixed: Windows device names (con, nul, com1, NUL.txt) would make the write fail and the agent lose its browser. They get a leading underscore and the hash.
- Fixed: the Windows default is now win32supervisor.browserFor(spec), tested with a fake launchConfig: it passes the agent's name.
- Fixed: the name test now checks every key's characters, that none ends in a dot or is a device name, that every file stays directly in the agents folder, and that 17 distinct names give 17 distinct keys. Removing the hash turns it red.
- Deferred: falling back to the shared file when a per-agent write fails. The hash removes the naming causes; any other write failure would hit the shared file too.
- Plan wording: the shared mcp-config.json is still written by a launch with no name (the old "Open" line said nobody reads it).

## Challenge loop iteration 2 (opus)
- Fixed: main() itself is now guarded on Windows. Its existing test injects a fake agentbrowser module (agentBrowserModule) instead of a ready answer and asserts it was asked with { agent: 'entry' }. Reverting main() to an unnamed call turns it red.
- Fixed: the #8929 shim test runs each of its four refusing arms with a name too, and asserts nothing appears under the fallback agents folder; a named control outside a test run writes agents/mona-lisa.json. Removing the #8929 guard turns the named arms red.
- Fixed: the hash joins with `~`, which cleaning never leaves, so a hashed key cannot equal another agent's plain key. The comment now names every hashed case.
- Noted for slice 2 or 3: nothing removes a deleted agent's per-agent file or output folder.
