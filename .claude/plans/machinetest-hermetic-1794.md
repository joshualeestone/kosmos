# Plan: make engine/machine.test.js hermetic (#1794 slice)

## Context
#1794/#835: the engine suite has non-hermetic tests that read host state, so they pass on Agent1s
(where they were tuned) and fail on a clean runner. This blocks mortals (and any second box) from
completing a cut, because the cut's step-3 suite gate requires the suite green on the runner.

Concretely demonstrated standing up the mortals cut box: `engine/machine.test.js` "five checks come
back, and the two kinds of not-ok are counted apart" passes on Agent1s and FAILS on mortals at the
SAME sha + SAME node (v26.8.1). Failing assertion: `assert.equal(mixed.unknown, 1)` -> 2==1.

## Root cause
machine.js `launchDir()` = `AGENT_WORKFORCE_LAUNCH || $HOME/Library/LaunchAgents`. The test's FIRST
`machine.check()` call (`got`) sandboxes AGENT_WORKFORCE_LAUNCH, but RESTORES the real value before
the SECOND call (`mixed`). So `mixed`'s `labels` check reads the operator's real ~/Library/LaunchAgents:
Agent1s has a com.kosmos.board.*.plist (labels ok), a clean runner does not (labels unknown), pushing
the unknown count 1 -> 2.

## Change (test-only, additive)
Sandbox AGENT_WORKFORCE_LAUNCH around the `mixed` call too, mirroring the `got` pattern (set an empty
temp dir, run the call, restore the prior value, clean the temp dir). 13 insertions, no deletions,
engine/machine.js untouched.

## Verification (done)
- Full engine/machine.test.js: 65/65 pass on Agent1s.
- RED -> GREEN proof: the UNFIXED test fails on mortals (the mortals cut aborted on it, 2==1); the
  FIXED test PASSES on mortals (copied over, ran, restored). So the fix makes it hermetic on a clean
  runner, which is the whole point.

## Scope / non-goals
- This is ONE of the ~24 non-hermetic engine tests (#1794). The mortals cut aborts at the first red,
  so completing mortals full-cuts needs the full sweep; this is the first slice, and the class/pattern
  (a check reading real $HOME/launch/config state a test sandbox forgot to cover) is documented on #1794.
