# aoc-callerenv-5849: the agent-online check's test must not depend on the caller's environment

Card: #5849. Same shape as #5844 (fixed by #5846), found by sweeping for it.

## What was wrong

`tools/test-staging-agent-online-check.sh` runs each case through `env "$@" ...`, which adds the case's variables to
the caller's. A case that means "no override" names none, so an exported `KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1` (or a
raised `KOSMOS_AGENT_ONLINE_MAX_EXISTING`) reaches the check, the populated-fleet guard stands down, and two cases
report "expected exit 2, got 0".

## The change (the test only)

1. `run_case` clears the two guard variables and the fixture's four `MOCK_*` variables before applying the case's
   own. A case now means exactly what it names.
2. A new case is the control: it is run with the override exported and the limit raised by its caller, names neither,
   and must still be refused.

## Rejected

- **An `unset` at the top of the file**, as #5846 did for its check. It works, but nothing in the file would go red if
  someone removed it. Clearing in `run_case` lets a case inside the same file play the caller.
- **`env -i`.** The check needs PATH and TMPDIR, and a clean slate would hide the next variable it starts reading.

## Measured (on 8aba1ed04 plus this change, the one file alone)

| Run | Exit | Note |
|---|---|---|
| clean | 0 | 20 cases pass |
| caller exports `ALLOW_LIVE=1`, `MAX_EXISTING=99`, `MOCK_PREEXISTING=0`, `MOCK_AGENT_STATE=auth` | 0 | 20 cases pass |
| a copy with the clearing removed | 1 | the new control case fails, "expected exit 2, got 0" |
| main before this change, `ALLOW_LIVE=1` | 1 | the two guard cases fail (the card) |

## Weakest part

The list of cleared variables is written by hand. If the check starts reading a new override, nothing forces it onto
the list. The final "no board.token" call does not go through `run_case`; it exits before any variable is consulted.
