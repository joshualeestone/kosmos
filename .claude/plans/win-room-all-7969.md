# kosmos#7969 (Windows CLI side): `kosmos room <id> --unanswered --all`

**Posture:** production

## Goal
Renet's #7969 ages an agent's own asks older than 3 days out of `kosmos room <id> --unanswered`, and adds `--all` to see them. The board and install/kosmos (Mac) are done on unansage-7969. The board's own "older asks" line tells agents to add `--all`, which the Windows CLI (tools/windows/kosmos-cli.js) would read as the project name. Spec: #7969, comment 6641259475.

## Done when
1. `kosmos room <id> --unanswered --all` sends `&unanswered=1&all=1`, with `--all` either side of the project id and beside `-n`.
2. A bare `--all` without `--unanswered` is refused with exit 2 and "--all goes with --unanswered: kosmos room <project-id> --unanswered --all", as install/kosmos does, and nothing reaches the board.
3. The usage line gains `[--unanswered [--all]]` and "from the last few days (--all: older ones too)", word for word as install/kosmos.

## Design
- Same order of checks as install/kosmos: a missing project prints the usage line first, then a bare `--all` is refused.
- The Windows CLI does not have the Mac's SIGPIPE false warning (it matches the filtered-view line with a regex), so nothing else changes.
- Safe before the board side merges: an older board ignores `&all=1`, and the existing "does not know --unanswered" check is unchanged.

## Tested (Windows box)
- tools.windows-kosmos-cli-gaps-4891.test.js: two new tests (the route for three argument orders, the refusal sending nothing, `--all` no longer read as the project, the usage text). Control: the same tests against origin/main's kosmos-cli.js fail (2 of 9), and pass with the change (9 of 9).
- All tools.windows-kosmos-cli-*.test.js plus no-name-refs, fixture-discipline and windows-tests-1777: 473 of 475 passed with 1 failure, #5946's real-PowerShell pipe test, under a full parallel run. That file passes 18 of 18 on its own with the change, twice, and on main. It was load, not this change.

## Review rounds
- Round 1 (blind reviewer): 0 BLOCKER, 0 WARNING, 2 NIT. Behaviour matches install/kosmos on unansage-7969 byte for byte (parse order, check order, strings, URL). Both NITs taken (test-only): the "both" case now asserts exit 0 and the route, and the route table includes a "-drafts" project id beside the new flags. Converged.
