# budgetslack-6754: the community follow budget tests have margins load cannot eat (kosmos#6754)

**Card.** engine/communityfollow.test.js "#4774 review 2 (W1): a call needing more requests than its budget allows
answers busy and does not POST" failed 3 of 3 on clean main at load 42 to 50: 100 ms per request with every answer
80 ms late left 20 ms of slack, so under load the late answer timed out and the call answered "could not be reached"
instead of busy.

**The call.** Keep the rule under test (a request that would not fit in what is left of the budget is never started)
and widen every margin: 3000 ms per request, a 4000 ms budget, the lookup answers at once and the registration takes
1500 ms. The registration is asserted to have gone out, so the cut is pinned between it and the POST. The
"cannot START within the wait ... never runs later" test in the same file had the same shape and gets the same
treatment (chain held 3000 ms, answer under 2000 ms, 300 ms for a late run to show).

**Rejected.** Accepting either refusal wording (it would stop the test telling a budget refusal from an upstream
failure). Uniform 500 ms late answers (review 1: it moved the cut to before the registration).

**Done when.** Both tests pass alone and in the whole file; the W1 test fails if request()'s budget check is removed
(mutation).

## Tests run (2026-10-21, after the rebase onto main)
- engine/communityfollow.test.js whole file: 31 pass, 0 fail, at load 6 to 13.
- Mutation: `if (false && ...)` on communitysend.js's OverBudget throw makes W1 fail (0 of 1); restored, tree clean.
- Not reproduced: the card's load of 42 to 50. The margins are argued, not measured, at that load.

**Weakest premise.** That 1500 ms of headroom covers any load this machine reaches. Load past the registration only
shrinks what is left, which makes the refusal more certain, so the exposure is the lookup and registration being
slower than about 1000 ms and 1500 ms respectively.
