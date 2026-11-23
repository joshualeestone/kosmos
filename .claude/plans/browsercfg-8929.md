# kosmos#8929: a test run must not rewrite the real board's agent-browser config

## Finished looks like
Inside a test run (node --test, or tools/run-tests.sh's KOSMOS_TEST_RUN), engine/agentbrowser.js launchConfig writes no config unless the runners folder is sandboxed (AGENT_WORKFORCE_RUNNERS_DIR), so a test can never leave a real board's agents with a test node and a deleted temp folder. Outside a test run (the board, a real launch) nothing changes.

## Evidence of the bug
This Mac's live config, written 03:11 11-23, named /opt/homebrew's node (the test node, not Kosmos's bundled one) and an output folder inside a run-tests root (kt23905). From a worktree runners.managedRoot() falls back to the real ~/.local/share/kosmos/runners, and launchConfig had no test guard (kickInstall had one). Which test wrote it is not established.

## Change (after review 1)
launchConfig writes nothing when inTestRunUnsandboxed(env): this process's runners folder is not sandboxed (read from process.env, where runners.managedRoot reads it) AND it is a test run by testRunMarked (NODE_TEST_CONTEXT; KOSMOS_TEST_RUN only when the temp folder is inside that run, the store's rule; or a temp folder inside a kt<pid> run root, for a test that scrubbed its env but kept TMPDIR) or live-execution's inTestProcess.

## Weakest premise
That every writer goes through launchConfig, and (review 1) that a test which scrubbed its env also kept a kt<pid> TMPDIR, as the live config showed. ensureInstalled and ensureShell also write under managedRoot, but kickInstall already refuses under node --test; a direct call to them from a test with no sandbox is not covered here.

## Evidence
Mutations, each red: the guard call removed; the run-root rule removed; a stray KOSMOS_TEST_RUN counted.
engine/agentbrowser.test.js: a unit arm (controls: sandboxed, and not a test run) and a shim arm through engine/agent-browser-config.js with no runners sandbox (the path the bug took; CONTROL: outside a test run it writes). Removing the guard turns both red. With fixture-discipline, engine.reachable, launchpath-5516, win32supervisor: 162/162; tools/test-supervisor-agentbrowser-3633.sh passes.
