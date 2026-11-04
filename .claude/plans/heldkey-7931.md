# heldkey-7931: dismissing a held question does not hide it asked for real (kosmos#7931, follow-up to #7916)

Stacked on heldtoday-7924 (on heldcount-7916, on heldq-7915) until they merge.

## Decided (reversible; my call)
projects.needsDismissKey keys a held question (the member's stateHeld, heldOwnQuestion's rule) as
`question-held:<words>`; a question that is not held keeps `question:<words>` byte for byte, so every stored
dismissal keeps its meaning. (On a board already running the unmerged held stack, a `question:` dismissal stored
while its row was held shows once more and lapses; main has no held, so no shipped board has one.) dismissNeeds accepts the new prefix under the same 300-unit cap and still refuses a bare
`question` or `question-held`. Engine only: the page and the phone send back the needsYouKey they were given; their
fallback key is for an engine that sends no key, which predates held.

## Rejected
A held flag stored beside the dismissal (a second field and upkeep path for the same result); clearing a dismissal when
held flips (a write in describe(), one direction only).

## Weakest premise
That a dismissed real question coming back once it is held is right. It returns as the calmer row, and lapses as any
changed reason does after NEEDS_GONE_MS.

## Tests
engine/projects-heldkey-7931.test.js: keys both ways, held then asked comes back, asked then held comes back, an
unchanged held row stays dismissed, a crash-looping held agent keys as
asked (heldOwnQuestion), the validator at and past the cap and a bare key. Mutation (stateHeld never read):
3 red, the 2 controls green. Every test file naming the key or dismissNeeds: 1519 pass, 0 fail.
