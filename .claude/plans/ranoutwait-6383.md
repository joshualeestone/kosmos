# ranoutwait-6383: the allowing computer says "press Try again" once the joining computer's code ran out

Card: joshualeestone/kosmos#6383 (from the multi-computer setup audit, notes in ~/.cache/claude-handoffs/multi-computer-setup-gaps.md).
Two PRs, either merge order is safe: kosmos-relay (the reason) and kosmos (the wording). An older app drops an unknown
reason and shows today's line; an older tunnel never sends the new one.

## Finished looks like
On the computer that allows a joining computer, once the joining computer's code has run out and nobody pressed Try
again there, the Allow card says "The code for <name> ran out. On <name>, press Try again for a new one." instead of
"It shows here in a moment."; once all tries are used it says "<name> used up its tries. Press Not me ...", matching
what the joining computer says. Tests prove both, with mutants red.

## Steps
1. kosmos-relay `crates/tunnel/src/pairing.rs` `wait_reason`: (a) after the `refused` check, a row with a code whose
   sender has `answered_by_mac >= MAX_ATTEMPTS` returns `attempts_used`; (b) LAST, after another_computer / daily_limit /
   wait_a_few_minutes, a row with a code (not live, not open) returns `code_ran_out`. Last on purpose: a Try again already
   pressed but held by A's spacing must not be told to press it.
2. Tests: ran out (control while live; hours later still; cleared after Try again answered), all tries used (control
   one short says code_ran_out; premise B failed and no `refused`). Mutant: both branches disabled, both red.
3. kosmos `engine/remote.js` CODE_WAITS gains `code_ran_out`; `web/index.html` JOIN_WAIT_WORDS gains its line;
   `engine/remote.joincode-4794.test.js` passes it through (mutant red); `render-connect-sheet-4637.js` gets a
   code_ran_out arm.
4. Challenge loop, proof, PRs, merge on green.

## Known limits
- If B spent tries on another allowing computer, A's count is below 10 while B says Too many tries; A then says Try
  again. Rare (needs the coordinator to move B between approvers).
- Between B's Try again and A's next round (seconds) A still says press Try again.
