# wording-8735: first slice of the section-by-section wording pass (#8735)

Goal: pm brief under 40,000 (NEW_AGENT_GOAL). On main: 45,054. This slice: 44,369 (measured with CEILING forced to 1, after round 1 and Mona Lisa's read added two pointers back).

Cuts (all repeat a rule stated elsewhere in the block, no heading changed):
1. needs_you: "not one of the four ... the one that matters most" -> "It matters most: it is the only state ...".
2. Ask test: four examples and a closing moral -> "such as a sign-in or a payment". Pinned 5943 phrases kept.
3. "Blocked is also a state on your card" paragraph removed ("And tell the board" carries it).
4. React paragraph: pointer to "Talking about a message" removed (that section follows).
5. "What you hand a person": "Do not hand over the nearest thing" removed (restates "say so").
6. "Use their name": why the lines say "the person", in one clause.
7. Copied reference: the room-name gloss removed.

DOCTRINE_VERSION 59 -> 60, fingerprints pinned, doctrine-past regenerated, ratchet 45,100 -> 44,400.
Tests: 141 related files (defaults/doctrine/instructionreread/dmfiles/claimguide + cli-verbs parity): 4360, 0 failed.
Weakest premise: the Blocked pointer in "Telling people" did work for an agent reading that section alone.

Round 1 (sonnet, blind): no blocker. should-fix: Blocked pointer (taken, one line on the bullet); nit: needs_you line re-wrapped (taken).
Mona Lisa's read: take 1,4,5,6,7; cut 2 keep "a preference about their own business" (taken); cut 3 pointer "under You do not stop" (taken).
Round 2 (opus, whole branch): no blocker. Taken: plan figure, log order and "states it later", heading quoted in the Blocked pointer, needs_you wrap. Not taken: the full --on/--owner form in the pointer (the pointer leads to it; kept short).
