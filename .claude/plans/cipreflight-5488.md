# cipreflight-5488: a runner user's suite does not refuse preflight

Card: kosmos#5488 (GitHub Mac test queue). Design gap recorded on the card when the second runner
(`kosmos-ci2`) went live on 2026-10-22: `tools/ci-runner-setup.sh preflight` refuses whenever any
process of any user names run-tests.sh or queued-heavy.sh. On a Mac already given to CI, runner 1's
job is exactly such a process, so adding runner 2 needed runner 1 drained by hand (KOSMOS_CI_RUNNER
set off for 13 minutes).

## Decided
1. The live-suite check still lists with `pgrep -fl` (its failure semantics are unchanged: exit 2 or
   more refuses). Each listed pid's owner is then read with `ps -o user= -p <pid>`.
2. A pid owned by a runner user (`^kosmos-ci[A-Za-z0-9_-]*$`: kosmos-ci, kosmos-ci2, ...) is printed as
   a note ("a runner's suite, not counted") and dropped. Everything else counts as before.
3. A pid whose owner cannot be read (the process is gone, or ps failed) stays counted: a false refusal
   is the safe side, as the existing comment says.

## Rejected
- An override variable (KOSMOS_CI_IGNORE_SUITES or similar): an override turns the step-0 check off for
  the owner's suites too, which is the case it exists for.
- Matching only `$CI_USER`: runner 1's user is NOT the user being set up, so that would miss the case.
- Replacing pgrep with one `ps -axo user=,command=` listing: changes the failure path the pgrep-fails
  test covers, for no gain.

## Weakest premise
That no owner or agent account on a CI Mac is named kosmos-ci<something>. A human account named like
that would have its suites ignored. The pattern is fixed rather than read from KOSMOS_CI_USER, because the
runner being set up is not the one whose suite is running. The runners live today are kosmos-ci and kosmos-ci2 (#5488, 10-22).

## Tests (tools/test-ci-runner-setup-4601.sh)
- suite-owner: an owner pid that is known (agent1) still refuses.
- suite-mixed: a runner's suite beside an owner's still refuses, naming the owner's line.
- suite-lookalike-user: kosmos-cix.y is not a runner name; refuses.
- suite-prefixed-user: xkosmos-ci is not a runner name (the ^ anchor); refuses.
- suite-runner: two runner users' suites pass preflight, each printed as a note, no REFUSE.
- the existing `suite` case (owner unreadable) still refuses.

## Not claimed
- verify does not run this check; nothing changes there.
- the old Mac's auto-login for kosmos-ci2 (the other open risk on the card) is untouched.
