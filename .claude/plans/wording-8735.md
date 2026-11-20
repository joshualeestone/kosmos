# wording-8735: first slice of the section-by-section wording pass (#8735)

Goal: pm brief under 40,000 (NEW_AGENT_GOAL). On main: 45,054. Slice 1 alone: 44,369; with slice 2: 44,027, and 44,103 after round 4 put the check note's 1000 back. Ratchet 44,200.

Cuts (all repeat a rule stated elsewhere in the block, no heading changed):
1. needs_you: "not one of the four ... the one that matters most" -> "It matters most: it is the only state ...".
2. Ask test: four examples and a closing moral -> "such as a sign-in or a payment". Pinned 5943 phrases kept.
3. "Blocked is also a state on your card" paragraph removed ("And tell the board" carries it).
4. React paragraph: pointer to "Talking about a message" removed (that section follows).
5. "What you hand a person": "Do not hand over the nearest thing" removed (restates "say so").
6. "Use their name": why the lines say "the person", in one clause.
7. Copied reference: the room-name gloss removed.

DOCTRINE_VERSION 59 -> 60, fingerprints pinned, doctrine-past regenerated, ratchet 45,100 -> 44,400 (slice 1 alone; final value below).
Tests: 141 related files (defaults/doctrine/instructionreread/dmfiles/claimguide + cli-verbs parity): 4360, 0 failed.
Weakest premise: the Blocked pointer in "Telling people" did work for an agent reading that section alone.

Round 1 (sonnet, blind): no blocker. should-fix: Blocked pointer (taken, one line on the bullet); nit: needs_you line re-wrapped (taken).
Mona Lisa's read: take 1,4,5,6,7; cut 2 keep "a preference about their own business" (taken); cut 3 pointer "under You do not stop" (taken).
Round 2 (opus, whole branch): no blocker. Taken: plan figure, log order and "states it later", heading quoted in the Blocked pointer, needs_you wrap. Not taken: the full --on/--owner form in the pointer (the pointer leads to it; kept short).

## Slice 2 folded in (14:00, the 0.8.13 hold kept slice 1 from merging alone)
Same doctrine 60. Mona Lisa's read: take b, d, e; a keeps the greeting line; c drops only the sizes.
Built: a, b, d (pinned "every agent on this computer" kept, #4449), c for the check note only.
Not built, and why: e ("hand it work the same way"), server.js cites it as the promise #4491 keeps;
c on the built note, #8352 pins that agents are told its real limit ("it holds 1000 characters").
pm: 44,027 (measured). Ratchet 44,100. Related tests 4,382, 0 failed (#5786 tunnel tests flaked once under load;
engine/remote.test.js alone passes on the branch, 247, and on main, 246).

Round 4 (opus, whole branch): no blocker. Taken: the check note keeps its 1000 (doctrine 51, #8668, states it nowhere else), the heredoc line says the delimiter is quoted, the ratchet history line, the log wrap and "first two slices". Not taken: "a password" back in the ask test (a sign-in covers it; Mona Lisa's read agreed).
