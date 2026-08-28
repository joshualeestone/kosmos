# titlename-1168: a title is not the end of a sentence

## The problem

#1271 (card #1168) is live in the served 0.5.99 artifact and truncates any prose agent name
that contains an abbreviation. Verified by Splinter out of the shipped tarball, and by me
against both the pre-change and post-change code:

```
"You are Dr. Smith, a copywriter."   BEFORE  Dr. Smith / copywriter   AFTER  Dr / null
"You are J. R. Tolkien, a writer."   BEFORE  J. R. Tolkien / writer   AFTER  J. / "R"
"You are Mr. Wolf."                  BEFORE  Mr. Wolf.                AFTER  Mr
```

The lookbehind I added stops the name at ANY word ending in a full stop. That is correct for
`Bob. He writes copy.` and wrong for every title and every spaced initial.

## Why it matters now rather than eventually

Josh's next test is the clean-machine one: wipe, new macOS account, install Claude,
**hand-create agents**, install Kosmos and see if it discovers them. **A person hand-writing
agent definitions is exactly the population this breaks**, and it is the population that has
never existed on this fleet: every CLAUDE.md here is generated and bold, so the non-bold arm
is only ever exercised by people outside it.

## The change

⚠️ **This section was rewritten after three review iterations. What it originally specified
(`{0,3}`, `Jr.`/`Sr.` as joinable, a tail-trim special case) was measured out; the sections
below record why. This is the shipped shape.**

1. **A stop may be crossed only while the name is still its own prefix**: every token from
   `You are ` to that stop must be a title (`Dr. Mr. Mrs. Ms. Prof. Rev. Hon. St.`) or an
   initial. That separates `J. R. Tolkien` from `Mary J. She`, `Bob Jr. He` and `Anna St. He`.
2. **`{0,4}`.** Held at the pre-#1168 `{0,2}` for three iterations on a SCOPE argument that
   iteration 4 falsified: a title consumes a slot, so an ordinary name truncated into something
   that still looked like a name. Negatives hold at `{0,3}`, `{0,4}`, `{0,5}` and `{0,10}`,
   measured by two reviewers independently.
3. **In the prose arm a role must follow a comma.** Nothing else becomes one.

## What must not move

- `You are Bob. He writes copy.` stays `Bob` with **no role**. That was #1168's expensive
  half: it invented a role out of the following sentence.
- `You are Bob.` and `You are Mary Anne Smith.` lose the trailing stop.
- `You are J.R.` keeps it.
- The negative controls still refuse: the working-rules prose in `engine/defaults.js` must not
  read as a person. **Widening the name by one word is the direction that finds people in
  prose**, so those are asserted in the same test rather than assumed.

## Verification

- Both arms: reverting `engine/status.js` **as a whole** turns the new test red.
  ⚠️ **That is whole-file, not per-edit**, and the blind review measured the difference: two
  of the first version's three edits could be reverted individually with the suite still
  green. Both of those edits are now gone rather than defended.
- Full suite green.
- Measured against the pre-#1271 code for every row, so the claim "this restores what was
  lost" is a comparison rather than an assertion.

## What the blind review changed, because the first version was worse than this one

- **`Jr|Sr` removed from the joining list.** They are TRAILING abbreviations, and crossing one
  put the fabricated role straight back: `You are Bob Jr. He writes copy.` gave
  `"Bob Jr. He"` / `"writes copy"`.
- **`St` kept, but a title may only be crossed as the FIRST word.** It is a prefix in
  `St. John Rivers` and a surname in `Anna St.`; only position separates them.
- **`{0,3}` reverted to `{0,2}`.** It was measured to be unnecessary: every row here passes at
  `{0,2}`. Its only effect was on prose, capturing one word further.
- **`NAME_TAIL_ABBREV` deleted.** The comment justifying it was false: the trim removes exactly
  one character, so `Mr. Wolf.` works without it, and its only observable effects went the
  wrong way (`Bob Jr.` kept a sentence-ending stop).
- **A truncated name no longer donates its tail to the role.** `Dr. J. R. R. Tolkien, a writer.`
  had produced role `"Tolkien"`, a surname presented as a job.

## Iteration 2 of the review found a BLOCKER in the fix itself

- **`NAME_TRUNCATED` tested the wrong thing.** It asked "does the tail start with a capital",
  intending "did the name run out of room". Those coincide on a truncated name and also on
  **every legitimate capitalised role**, so it silently deleted them:
  `You are Nevaeh, Chief Engineer.` lost its role, and the bold arm kept the same one, so the
  two arms disagreed. **The discriminator is the COMMA**: a role follows one, a donated name
  tail does not.
- **A bare middle initial reopened the fabricated role.** `You are Mary J. She writes copy.`
  gave name `"Mary J. She"` and role `"writes copy"`. A stop may now be crossed only while
  everything before it is still a title or an initial, which is what separates
  `J. R. Tolkien` from `Mary J. She`.
- **The `Jr|Sr` comment was stale.** With the prefix anchor in place, adding them back is
  inert. The exclusion stays; the comment now says so rather than asserting a measurement that
  no longer reproduces.

## Iteration 4

- **Four of the eight titles had no test.** Mutation showed the list could be cut to
  `Dr|Mr|Ms|St` with the suite green. `Mrs`, `Prof`, `Rev`, `Hon` now have one assertion each,
  which matters because the list is interpolated into a `new RegExp` where a typo is silent.
- **The bound widened to `{0,4}`**, above.
- **The pinned cost of the comma rule was the less likely half.** The newline form was pinned;
  the same-line `You are Anna the copywriter.` was not, and it regresses the same way.
- **A known limit is now pinned rather than left looking like an oversight:**
  `Dr. John Q. Smith` truncates, because the prefix run refuses to cross after `Q.` and that
  shape is text-identical to `Mary J. She writes copy.`, which must stop. Undecidable here.
  ⚠️ The review offered the bound as the fix for it; **I checked and it is not**, which is why
  the comment says so rather than repeating the suggestion.
- Two orphaned comments removed, and the bold-arm justification narrowed to what is true.

## Iteration 5

No blockers. Three coverage gaps, and all three are **controls aimed at an arm that cannot
fail**, which is this branch's recurring mistake rather than three unrelated ones:

- **`Ms` survived mutation while the other seven died.** Iteration 4 added a title row each,
  and the `Ms` row asserted a NULL ROLE on `Ms. Understood by all.`, which is null whether or
  not `Ms` is in the list. Fixed with a row that crosses it. **Re-run the mutation myself
  afterwards rather than trusting the fix: all eight now die.**
- **The widening canary saturates.** `The Owner Of This Machine` is exactly five Title-Case
  words, so it pins narrowing and survives `{0,5}`, `{0,10}`, `{0,50}` unchanged. A longer
  canary now moves one word per step.
- **The bold arm's exemption from the comma rule was unpinned**: mutating the guard away left
  the suite green while deleting every bold no-comma role.
- The `Jr` inertness claim was over-stated: inert for a name that CROSSES one, not at first
  position. The comment now says which half reproduces.

⭐ And a structural reason the widening is safe, which is better than the empirical result:
the trailing `([^.\n]*)` can match empty, so the bound cannot change match-versus-no-match,
only name length. **It cannot invent an agent out of prose; it can only lengthen a false
positive that already existed.**
