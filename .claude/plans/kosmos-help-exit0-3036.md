# kosmos-help-exit0-3036: `kosmos <verb> --help` must exit 0, not 2 (kosmos#3036)

## The defect (Casey + Rocky, 0.6.63 fresh-install QA; source QA-findings-for-developers.pdf #3)
Explicit `--help` on the SEND-guarded message verbs prints usage correctly but exits **2**:
`kosmos msg --help ; echo $?` -> prints usage, exit 2. Same for post, reply, react, report,
room, feedback, task (both testers, verified). Conventionally `--help` exits 0; a script or
smoke test doing `kosmos msg --help && echo ok` reads a working help screen as a failure.

## Root cause
The #1674 guard (install/kosmos ~1643) intercepts `-h`/`--help` before dispatch so these verbs
never SEND (`kosmos reply --help` used to transmit "--help" as the message). For a message verb
it re-dispatches BARE (`set -- "$1"`), which reuses the verb's own usage string (no duplicate)
but then hits the verb's bare-usage branch, whose `exit 2` is the missing-required-argument
error. So a *successful* help request inherits the *error* exit code.

## The fix (install/kosmos)
Split the #1674 case:
- `msg|reply|post|react|report|room|feedback|task)` -> re-dispatch bare in a subshell
  `( "$0" "$1" ) || true` (reuses the verb's own usage; `|| true` keeps `set -e` from
  propagating the contained exit 2), then `exit 0`. A --help that reached the usage succeeded.
- `adopt|whoami)` -> keep the bare `set -- "$1"` re-dispatch: they show read-only OUTPUT on
  --help and their exit status is meaningful (a failed whoami must not read as success).

## Deliberately NOT changed
- The #1674 no-SEND routing (kept; the fix re-dispatches bare, dropping args, so `kosmos msg
  <agent> --help` still cannot send).
- A GENUINE bare `kosmos msg` (no --help) still exits 2 (the real missing-arg error).
- Top-level `kosmos --help` already exited 0 (unchanged).

## Test (tools/test-kosmos-help-exit0-3036.sh, wired into test:shell)
Runs the REAL install/kosmos (so a revert reds it): 8 verbs --help -> exit 0 + usage; control
each bare verb still exits 2; top-level --help exits 0; #1674 mid-args prints usage/no send;
source guard that adopt|whoami stay a separate case. Red-capability verified: reverting the fix
produces 10 failures; the controls pass in both states.

## Weakest premise
The behavioural arms invoke `install/kosmos <verb> --help` in the test env; they rely on the
usage-print path needing no board/network (verified locally: pure usage print, no side effects).
If CI lacks something the bare re-dispatch needs, an arm could false-red -- but the usage path
is deliberately board-free (#1674's whole point is it never acts).
