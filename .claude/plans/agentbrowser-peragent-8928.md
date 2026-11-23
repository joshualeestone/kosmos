# kosmos#8928 slice 1: each agent's browser config names the agent

## Finished looks like
Every agent launch that gets a browser config gets its OWN file and its own output folder, both named for the agent, so a Playwright MCP server process names its agent on its command line (`--output-dir .../kosmos-agent-browser/<agent>`). A leftover server can then be traced to its agent (slice 2 ends those whose parent is gone; slice 3 is `kosmos browser stop`). A launch with no agent name keeps today's shared file, so nothing that calls launchConfig() bare changes.

## Change
- engine/agentbrowser.js: `launchConfig({ agent })`. A safe name (letters, digits, dot, dash, underscore; anything else replaced; empty or `.`/`..` refused, falls back to the shared file). `configPath(agent)` = `<home>/agents/<safe>.json`; `outputDir(agent)` = `<tmp>/kosmos-agent-browser/<safe>`.
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
