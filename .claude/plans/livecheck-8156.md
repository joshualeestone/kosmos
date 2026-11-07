# livecheck-8156: a throwaway agent on a shared box can find the zz-livecheck- prefix (#8156)

Card: https://github.com/joshualeestone/kosmos/issues/8156

## Item 1: find the prefix without reading the guard

- `kosmos agent --help`, Mac (install/kosmos cmd_agent) and Windows (tools/windows/kosmos-cli.js USAGE.agent), same two lines under `agent create`: either form, a throwaway agent on a Mac that runs test suites is named `zz-livecheck-<something>`, which the test suites' check for stray agents skips. "Mac", because the guard watches ~/Library/LaunchAgents only; the words are kept identical in both CLIs on purpose. No card numbers in this person-facing help.
- The #3011 LEAK message in tools/run-tests.sh says first to read the names and working dirs (each listed line shows its working dir; a real agent's is its own folder, a test's usually a temp folder): an agent someone made on this computer during the run, from the board or by `kosmos agent create`, is not a test's leak, so confirm it is real (on the board, or its maker says so) before leaving it in place, since a test can write a plist with a real working dir too (#5092). It used to open with "Move them out", which for a real agent breaks it.
- Pinned by `cli.livecheck-prefix-8156.test.js`: both CLIs' `agent --help` (run with a fresh HOME and no token) name the prefix the guard declares, and the LEAK message names it and says to read the names before moving anything.

## The guard's own search

`tools/test-launchagent-leak-guard-3011.sh` fails if any tracked file other than the guard and itself names the prefix (#4392: no test may use it, or its leak would be hidden). The three files that tell a person the prefix (install/kosmos, tools/windows/kosmos-cli.js, tools/run-tests.sh) stay in the search with an exact allowed count of uses each (ALLOWED; occurrences, not lines, so a second use on an allowed line also fails), so one more use in them fails, and finding all three is the search's own control (a search that finds nothing fails as missing). The pin test never spells the prefix; it reads it from the guard. Controls run by hand: an extra use in install/kosmos, a second use on its allowed line, a new tracked *.test.js naming the prefix, and a help line removed from the Windows CLI each fail it.

## Item 2: decision

**A new agent made on the board while a suite runs stays red, on purpose.** The #5092 review rejected skipping new plists: a test writing a plist with a real WorkingDirectory looks identical from the shell, so any skip for "made by a person" would also hide a test's leak. The fix is the message: it now says to read the names first and to leave a real agent in place.

Rejected: skipping a new plist whose WorkingDirectory is a live agent folder (the #5092 shape, refused there for new files); a marker file written by `kosmos agent create` (a test could write it too, and a board-made agent would still need the same marker).

Weakest part: it still costs a person a rerun when someone makes a real agent mid-suite. What would change it: a way to tell a board-made plist from a test's that a test cannot fake.

Out of scope: `kosmos agent remove` leaving its plist in place (the card says not yet measured whether that is by design; a removed agent can be put back).

A release note or doc for this change must not spell the prefix: the guard searches every tracked file except `.claude/plans/` and allows it only in the ALLOWED files, exactly as many times as ALLOWED says for each.

Accepted cost: the two help lines reach every install, including people whose computer runs no test suites and Windows, where the check does not exist. Kept identical across the CLIs on purpose.

Accepted trade (review 9): advertising the prefix makes the guard's one exemption easy to find, so a seat someone forgets is never reported by any later suite. The help says to remove the seat when done, and that the check never reports it; nothing stronger is built, since the exemption exists so a live check can run beside a suite.
