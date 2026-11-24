# renewwait-8965: test-cut-claim-renew-5134 waits for the renewer to stop instead of sampling once (kosmos#8965)

## Goal
Arm 7 of tools/test-cut-claim-renew-5134.sh went red in a loaded full run ("the renewer kept running beside a foreign
claim (alive)") and passed alone minutes later. It read the renewer's liveness once, 3 s after the foreign claim
appeared; under load the renewer can take longer than that to see it and exit.

## Change
- Keep the 3 s wait and the "foreign claim left alone" check as they were.
- Then wait up to 15 s (every 0.2 s) for the renewer to exit before recording alive or gone. The failure line names
  the bound.

## Tests
- The script passes on this tree.
- Mutant: the renewer lingers 60 s after seeing a foreign claim (instead of exiting): the check reds with "kept
  running beside a foreign claim for 15 s (alive)".

## Weakest premise
That 15 s is enough under the heaviest load this Mac sees; the renewer checks every 1 s in this test, so 15 s is
fifteen of its intervals.
