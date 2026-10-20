---
method: challenge-loop
branch: fedfield-6681
diff_hash: 207f7b793c6a02eb8a7897ab6be329cefd02262c33e294c5d08b336e5446e142
timestamp: 2026-10-20T13:05:38Z
subdir_audit: passed
iterations: 3
converged: true
---

# Challenge-loop proof: fedfield-6681 (kosmos#6681 slice 2: the invite sheet's optional email field)

Three blind iterations (Opus, Sonnet, Opus) plus a design review (Mona Lisa, approved with one copy change). Iteration 3
returned no BLOCKER or WARNING, so it converged. Rebased onto main after #6688 merged (08eb270b4d); the hash covers origin/main...HEAD.

## Iteration 1 (Opus)
[WARNING] the "empty on open" check could not fail on a removed reset (a reopen arm added)
[WARNING] a bad-email refusal put focus on the label field (now marks the address field)
[CONVENTION] uncommitted design-review edits; no plan file for the branch (committed; plan added)
[NIT] no in-page check of an obvious non-address (validity.typeMismatch, answered without a request)
[NIT] maxlength counts UTF-16, the board bytes; autocomplete=off is only a hint (both stated)

## Iteration 2 (Sonnet)
[WARNING] the refused-address arm did not prove Make and Cancel come back (asserted)
[WARNING] a "label not invalid" check could not fail (replaced with the label's bad class)
[NIT] aria-describedby difference with the sibling; typeMismatch on the untrimmed value; the shots screen's gate override

## Iteration 3 (Opus): converged
[NIT] the typo arm's invalid reading was set by the arm before (cleared first)
[NIT] the done step does not say the code is bound (stated, a later slice)
[NIT] no shot of the refused state (stated)
[STRENGTH] the contract matches the engine; accessibility as the sibling field; the reset tested as a person hits it

Tests: render-federation-invite-4649.js all arms pass; mutants (the send, the reset, the refusal routing) each red.
A stale value set before the sheet opened broke arm B15g; the reset arm now types, cancels and reopens instead.
