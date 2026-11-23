# kosmos#8929: a test run must not rewrite the real board's agent-browser config

## Finished looks like
Inside a test run (node --test, or tools/run-tests.sh's KOSMOS_TEST_RUN), engine/agentbrowser.js launchConfig writes no config unless the runners folder is sandboxed (AGENT_WORKFORCE_RUNNERS_DIR), so a test can never leave a real board's agents with a test node and a deleted temp folder. Outside a test run (the board, a real launch) nothing changes.

## Evidence of the bug
This Mac's live config, written 03:11 11-23, named /opt/homebrew's node (the test node, not Kosmos's bundled one) and an output folder inside a run-tests root (kt23905). From a worktree runners.managedRoot() falls back to the real ~/.local/share/kosmos/runners, and launchConfig had no test guard (kickInstall had one). Which test wrote it is not established.

## Change
inTestRunUnsandboxed(env), exported; launchConfig returns null when it is true.

## Weakest premise
That every writer goes through launchConfig. ensureInstalled and ensureShell also write under managedRoot, but kickInstall already refuses under node --test; a direct call to them from a test with no sandbox is not covered here.

## Evidence
engine/agentbrowser.test.js: a unit arm (controls: sandboxed, and not a test run) and a shim arm through engine/agent-browser-config.js with no runners sandbox (the path the bug took; CONTROL: outside a test run it writes). Removing the guard turns both red. With fixture-discipline, engine.reachable, launchpath-5516, win32supervisor: 162/162; tools/test-supervisor-agentbrowser-3633.sh passes.
