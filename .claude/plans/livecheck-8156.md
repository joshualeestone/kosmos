# livecheck-8156: a throwaway agent on a shared box can find the zz-livecheck- prefix (#8156)

Card: https://github.com/joshualeestone/kosmos/issues/8156

## Item 1: find the prefix without reading the guard

- `kosmos agent --help`, Mac (install/kosmos cmd_agent) and Windows (tools/windows/kosmos-cli.js USAGE.agent), same two lines under `agent create`: a throwaway agent for a check, on a computer that runs test suites, is named `zz-livecheck-<something>`, which the suites' leak guard skips (#4392).
- The #3011 LEAK message in tools/run-tests.sh says first to read the names: an agent someone made on this computer during the run, from the board or by `kosmos agent create`, is not a test's leak, so leave it in place. It used to open with "Move them out", which for a real agent breaks it.
- Pinned by `cli.livecheck-prefix-8156.test.js`: both CLIs' `agent --help` (run with a fresh HOME and no token) name the prefix the guard declares, and the LEAK message names it and says to read the names before moving anything.

## The guard's own search

`tools/test-launchagent-leak-guard-3011.sh` fails if any tracked file other than the guard and itself names the prefix (#4392: no test may use it, or its leak would be hidden). It now also excludes the four files that only tell a person the prefix: install/kosmos, tools/windows/kosmos-cli.js, tools/run-tests.sh and the new pin test. None makes an agent. Control: a new tracked `*.test.js` naming the prefix still fails the search.

## Item 2: decision

**A new agent made on the board while a suite runs stays red, on purpose.** The #5092 review rejected skipping new plists: a test writing a plist with a real WorkingDirectory looks identical from the shell, so any skip for "made by a person" would also hide a test's leak. The fix is the message: it now says to read the names first and to leave a real agent in place.

Rejected: skipping a new plist whose WorkingDirectory is a live agent folder (the #5092 shape, refused there for new files); a marker file written by `kosmos agent create` (a test could write it too, and a board-made agent would still need the same marker).

Weakest part: it still costs a person a rerun when someone makes a real agent mid-suite. What would change it: a way to tell a board-made plist from a test's that a test cannot fake.

Out of scope: `kosmos agent remove` leaving its plist in place (the card says not yet measured whether that is by design; a removed agent can be put back).
