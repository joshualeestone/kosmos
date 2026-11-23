# kosmos#8935: the first use of a command with a longer guide names the guide, once per agent

## Finished looks like
The first time an agent really uses `kosmos claim`, `task`, `post`, `community`, `connections` or `report` (with arguments; not `--auto`), on a Mac (once per agent) or on Windows (once per launch: a Windows agent carries only a launch token), the command prints one line on stderr naming that command's guide (`kosmos <cmd> --how`; for report, `kosmos report --help`). The same agent never sees it again for that guide, and never sees it at all if it read the guide first with `--how` (report has no --how; its --help is answered before the hint, so report's pointer can show once). A person in their own Terminal never sees it. A command's stdout is unchanged; its stderr gains one first line, once.

## Shape (posted on the card, comment 7106272674)
- One engine module, engine/howhint.js: the guide table, the decision and the record (`how-hints.json` in store.currentDataRoot(); KOSMOS_HOWHINT_FILE is a test seam). Never throws.
- install/kosmos: `_how_hint <cmd> "$@"` before the six commands; only an agent's call reaches node; output to stderr; never fails the command.
- tools/windows/kosmos-cli.js: the same call in main() before the handler, through ctx.engine, inside its own try.
- Not on `kosmos task built`: #8934 (Baron) prints its own line naming the task guide there (agreed in the room).

## Rejected
Pointers on specific cases only (first repeating task, first formatted post, first --held): each needs detection in two CLIs, and the plain case has the same risk. Printing on every use: noise.

## Weakest premise
That agents read a command's stderr. Claude Code shows it with the output; a runner that hid stderr would make the pointer silent (nothing breaks).

## Evidence (first build)
- engine/howhint.test.js 5/5 and engine/howhint-cli-8935.test.js 2/2 (the real install/kosmos spawned; the Windows CLI's main()).
- Mutations, each red: the Mac hook removed from claim; the Windows hook removed; the once-only check removed.
- Every Windows CLI test file (40 files): 465 pass, 0 fail. Every node test that spawns install/kosmos as an agent (20 files): 759 pass, 0 fail. tools/test-board-watchdog-2955.sh and tools/test-ssh-keychain-note-2600.sh pass. fixture-discipline and engine.reachable pass.

## Challenge loop iteration 1 (sonnet)
- Measured, kept: each agent call of the six commands starts node once (about 20 ms; the store load adds little). A shell-side pre-check was rejected: it would derive the data folder a second time in shell. Stated in the comment.
- Fixed: the hint's node gets </dev/null, so a `post --stdin` can never lose input to it; stated: stderr gains one first line, once.
- Fixed: a test asserts every guided command's Mac dispatch line calls _how_hint (a missing one is caught), and the stdin redirect.
- Fixed: the record has no prototype, so an agent named __proto__ is recorded; the redirect order and the test-only seam are commented.

## Challenge loop iteration 2 (opus)
- Fixed (BLOCKER): Windows agents carry no KOSMOS_AGENT_SESSION, only KOSMOS_AGENT_TOKEN, so the Windows half never fired, and my test passed the variable real agents lack. The agent key is now the session name, or a hash of the launch token (never the token itself; once per launch on Windows; the record keeps the newest 500 keys). The Windows test uses the token.
- Fixed (BLOCKER): the report hook's `kosmos report` probe used up the report pointer where no agent sees it. A call with no arguments and any `--auto` call neither points nor marks; the Mac shell skips them before starting node, so the hook's hot path pays nothing.
- Fixed (BLOCKER): `report --help` on a Mac re-dispatches bare, so it showed the pointer to the guide being read. Bare calls no longer count, on both CLIs.
- Fixed: a test run that names no record of its own never points or writes (store.isTestProcess, through an opts.store seam so its test can fail; removing the check turns it red).
- Decided: `--help` does not count as reading for the --how commands (only `--how` does); report's guide is its --help, which no longer marks either, so an agent that read report --help may still see the pointer once.
- Evidence: 10/10 in the two files; mutations red (token key, --auto skip, test-run guard). Wide run: 1256 tests (40 Windows CLI files, 20 agent-CLI files, lints): 1248 pass, 0 fail.

## Initial validation (on the first build) and challenge loop iteration 3 (sonnet)
- The first build's full suite had 19 failures. The #4466/#4580 CLI tests were gone on the iteration 2 head (test runs never point). Three lints remained, fixed: the new tests added to tools/windows-tests.js (also iteration 3's finding); the record written through store.saveFlushed (no raw writeFileSync); engine/connections.test.js's pinned dispatch line allows the hint call. The four files plus the two new ones: 105/105.
- Fixed: `--help` is answered before the hint on both CLIs, so the report "reads it" branch was unreachable; removed, and the comment says report's pointer can show once to an agent that read its --help.
- Fixed: the record's folder comes from store.currentDataRoot() (now exported), not store.root(), so an agent's command never triggers the legacy-store migration.
- Fixed: the --auto skip applies to report only (a post whose text says --auto is just text); the record cap keeps recently seen agents.

## Challenge loop iteration 4 (opus)
- Fixed: the record write could create the data folder (blocking the legacy-store migration, at umask mode). Now: if the data folder does not exist, nothing is shown or written; only a test's own record (KOSMOS_HOWHINT_FILE) may make its folder.
- Fixed: a data folder under the system temp folder (a CLI test's sandbox, when its node grandchild carries no test marker) is never written to.
- Fixed: the Mac --auto skip applies to report only, as on Windows.
- Comments: the record is in store.currentDataRoot(); KOSMOS_HOWHINT_FILE is honoured anywhere (an agent controls its own env).
- Tests: 10/10 in the two files; mutations for these two guards run 10:3x, both red (each at its own case).

## Challenge loop iteration 5 (sonnet)
- Fixed: the Mac --auto skip matched the word anywhere in the arguments; it now matches a whole argument, as Windows does.
- Fixed: a call with no guide returns before the token is hashed.
- Plan: KOSMOS_HOWHINT_FILE is honoured for any caller (it skips the folder, temp and test-run guards and may make its folder); harmless, since an agent only steers its own pointer record.
- Deferred (as iteration 1): every guided agent call pays a node start (~20 ms), not only the first; a shell-side marker was rejected (a second derivation of the data folder).

## Challenge loop iteration 6 (opus)
- Fixed: the test-run guard checks this process's env as well as the one handed in, so a Windows CLI test with its own small env stops before any data root is resolved.
- Fixed: the Windows CLI test asserts `claim p` exits 2 (a local usage error), so it cannot quietly start reaching the network.
- Plan: the record is in store.currentDataRoot(); the finished sentence carries the report exception.
- Deferred to the closing full validation (it is the measurement): a CLI test that strips TMPDIR and the test markers but keeps an agent name and an existing sandbox data folder would get the pointer first on stderr.

## Challenge loop iteration 7 (sonnet)
- No new findings. Coverage stated by the reviewer: howhint.js and the CLI, store and lint diffs; not the tests or the report hook, so iteration 8 covered those.
- Closing validation on 6ad0ddd17c (the iteration 6 head) PASSED in full (validation rc=0, no failing test). This settles iteration 6's deferred question: no CLI test sees the pointer.

## Challenge loop iteration 8 (opus, tests and report hook)
- Fixed (WARNING, and worse than reported): the test-run guard's test had been vacuous since iteration 4. Its data folder did not exist, so the folder guard returned first, and its stand-in answered true for both envs. Now the folder exists and is not under the stand-in temp folder, each half of the guard has its own case, and a control points. Mutations: removing either half turns its own assertion red.
- Fixed (NIT): the Windows CLI test checks post --how exits 0 and reads the record: both launches are keyed by a hash of the token, reading the guide is recorded as seen, and no token is written down.
- Checked, no change: every `kosmos report` call in the report hook is bare or carries --auto as a whole argument; the Windows hook posts to the API and never calls the CLI; tools/windows-tests.js lists both files.
- Not done (NIT): a test that runs the shell's own --auto short-circuit. node's classify makes the same decision, so a broken shell loop costs only speed, never a wrong pointer.
