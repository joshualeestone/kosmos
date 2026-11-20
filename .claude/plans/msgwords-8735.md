# msgwords-8735: #8735, proposal cuts E, H and I

## Call
From my proposal on #8735 (comment of 2026-11-20 10:10 CST), the low-risk three; F (the render list) waits for a reader
and G (the shell trap) stays whole.
- E, "Send readable messages": keeps Josh's #2909 phrases, pinned in defaults.test.js (a grey block is a choice you are
  making, not a limit; from your first message; in project rooms and in your dialogue with the person alike) and drops
  the two sentences explaining them ("The person reading you sees headings..."; "This is the default, not a flourish").
- H, "Telling people what is happening": one paragraph says blocked is also a state on the card, a separate act from
  telling a person, which the person watching the fleet sees, with the pointer to the commands.
- I: drops "There is no separate command for starting one." (the sentence before it says reply starts a message).
Doctrine 58.

## Rejected
- A re-read note: each removed line is replaced by a shorter line in the same section, so the plain diff is the truth.
- F and G: see above.

## Measured
- pm brief 45,761 -> 45,382 (darwin), 379 characters. Ratchet 45,800 -> 45,400.
- Related tests: 1,762, of which 4 failed in cli.claim-6946.test.js during a load spike to 31 (15 to 30 s timeouts in a
  file this branch does not touch); that file alone: 12 of 12 pass.

## Weakest premise
That "the person sees headings and lists when you write them" taught nothing the choice-not-a-limit sentence does not.
