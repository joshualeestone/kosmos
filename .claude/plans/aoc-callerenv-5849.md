# aoc-callerenv-5849: the agent-online check's test must not depend on the caller's environment

Card: #5849. Same shape as #5844 (fixed by #5846), found by sweeping for it.

## What was wrong

`tools/test-staging-agent-online-check.sh` runs each case through `env "$@" ...`, which adds the case's variables to
the caller's. A case that means "no override" names none, so an exported `KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1` (or a
raised `KOSMOS_AGENT_ONLINE_MAX_EXISTING`) reaches the check, the populated-fleet guard stands down, and two cases
report "expected exit 2, got 0".

## The change (the test only)

1. `run_case` clears seven of the caller's variables before applying the case's own: the two guard variables,
   `KOSMOS_HOME` (the check prefers that home's bundled node), and the fixture's four `MOCK_*` variables.
2. Two new cases are the controls, each run with its caller exporting values that would change the answer:
   - the override exported and the limit raised, and a populated fleet is still refused;
   - a broken home and every fixture variable exported, and a case naming no scenario still gets the default one.
3. The three populated-fleet cases now also require the refusal's own words, because exit 2 is shared by every
   "cannot tell" path.

## Rejected

- **An `unset` at the top of the file**, as #5846 did for its check. It works, but nothing in the file would go red if
  someone removed it. Clearing in `run_case` lets a case inside the same file play the caller.
- **`env -i`.** The check needs PATH and TMPDIR, and a clean slate would hide the next variable it starts reading.

## Measured (on 8aba1ed04 plus this change, the one file alone, macOS)

| Run | Exit | Note |
|---|---|---|
| clean | 0 | 21 cases pass |
| caller exports the override, the raised limit and all four fixture variables | 0 | 21 cases pass |
| seven copies, each with one name dropped from the cleared list | 1 each | exactly one control case fails in each |
| main before this change, `ALLOW_LIVE=1` | 1 | the two guard cases fail (the card) |

Not run on Linux by me. `env -u NAME ... NAME=value cmd` is already used in this repo (`install/kosmos`,
`tools/test-feedback-digest-daily.sh`); CI on the pull request is the proof there.

## Weakest part

The list of cleared variables is written by hand. If the check starts reading a new override, nothing forces it onto
the list. The final "no board.token" call does not go through `run_case`, so it still sees the caller's
`KOSMOS_HOME`; it sets its own store root and exits at the missing token whichever node was found.

## Review notes

- Round 1 (opus): the control covered two of the six names; exit 2 alone did not prove the guard fired; `KOSMOS_HOME`
  still reached the check; the header list was stale. All fixed in the second commit. Left as is: the plan file name
  has no timestamp, which matches the plans already in this folder.
