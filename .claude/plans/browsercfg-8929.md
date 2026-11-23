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

## Review 2, taken
- BLOCKER fixed: the shim test made its "plain" temp folder inside SANDBOX, which under tools/run-tests.sh is itself inside a kt<pid> run root, so the two controls went silent. The plain folder is now made under /tmp (realpath), checked not to be inside a run root, and removed after the test. The run root the test fakes sits at SANDBOX/tmp/kt8929 and is used as TMPDIR directly (the live config's shape).
- WARNING fixed: the kt<pid> rule now matches only a kt<n> folder right under a temp base (T, tmp, Temp, case-insensitive), the shape run-tests.sh makes (${TMPDIR:-/tmp}/kt$$). CONTROLS: C:\Users\kt1\AppData\Local\Temp and /home/kt12/tmp are not a test run; ...\Temp\kt77 is.
- WARNING decided, not built: a test child spawned with a minimal env ({ PATH }) has no markers, TMPDIR falls back to /tmp, HOME to the real home, so it is not caught. Markers cannot see it. The structural fix (refuse to write the REAL account's runners folder from a source checkout) would also switch the browser off for a developer's source board, so I rejected it. What would change my mind: a second rewrite of the live config with no kt folder in it.
- NIT accepted: the inTestProcess() arm and the caller-env arm have no isolated test. In this file NODE_TEST_CONTEXT is always set and the runners folder is sandboxed, so neither can be isolated in-process.

## Evidence after review 2
tools/run-tests.sh --only engine/agentbrowser.test.js: 35/35 (the run review 2 said I had never done). Mutation under the same runner, the guard call removed: the shim test goes red (34/35). fixture-discipline, engine.reachable, launchpath-5516 under run-tests --only: 63/63. tools/test-supervisor-agentbrowser-3633.sh: all passed. No plain-tmp-8929 folder left in /tmp.

## Challenge loop iteration 1 (sonnet)
- Fixed: the #8929 block had been inserted between launchConfig's doc comment and launchConfig, so "Sync and NEVER throws" read as testRunMarked's contract. The block now sits above that doc comment.
- Fixed: the kt rule is now the machine-wide test-sandbox rule (tools/lib/process-fixture.sh _KOSMOS_KT_RE, `(T|tmp)/kt<digits>`, case-sensitive) plus Windows' backslash and Temp. Review 2's version was case-insensitive and wider than every other guard.
- Deferred: a real board whose temp folder is literally `.../tmp/kt5` would lose its browser. Every other fixture guard on this machine already treats that path as a test sandbox, so this keeps one rule rather than inventing a stricter one here.
- Deferred: the catch around live-execution fails open (toward writing), which is the old behaviour; the shim arm runs on a Mac only (the skip says so; the pure arm covers the Windows rule).

## Challenge loop iteration 2 (opus)
- Fixed: the shim test's two writing arms could have rewritten the LIVE config if the file were run from an installed layout (managedRoot ignores HOME there). The test now asks a child, with the same env, where the runners folder resolves, and skips before any arm runs unless it is inside the test's HOME.
- Fixed: testRunMarked re-derived store.isTestProcess (and compared with path.resolve where the store uses realish). Now the store's rule is called for this process and for a caller's env, and only the new rule, inKtRunRoot, lives here. A new arm proves the store's rule alone refuses (KOSMOS_TEST_RUN with no kt folder); removing the store call turns it red.
- Fixed: the Windows `Temp\kt<n>` arm is gone. Node on Windows takes its temp folder from TEMP/TMP, and run-tests.sh sets only TMPDIR, so it described a shape that does not occur.
- Card handling (deferred, decided): the PR says "Addresses #8929", not "Fixes". Which test wrote the live config is still not established, and ensureInstalled/ensureShell plus a minimal-env child remain uncovered (weakest premise above). The card stays open after merge until the live config has survived a full suite run unrewritten.

## Evidence after iteration 2
run-tests --only agentbrowser.test.js 35/35, not skipped. Mutations, each red under run-tests: the guard call removed (shim test), the store call removed (the new store-only arm). fixture-discipline, engine.reachable, launchpath-5516, win32supervisor under run-tests --only: 127/127.
