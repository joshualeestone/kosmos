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

1. **The discriminator is what precedes the stop**, not the stop itself.
   - a single letter is an initial (`J.`)
   - a known title is an abbreviation (`Dr.`, `Mr.`, `Mrs.`, `Ms.`, `St.`, `Jr.`, `Sr.`,
     `Prof.`, `Rev.`, `Hon.`)
   - anything else ends a sentence, and the name stops there
2. **The tail trim needs the same test**, or `Mr. Wolf.` loses its Wolf.
3. **`{0,2}` widens to `{0,3}`**, because `J. R. Tolkien` is three tokens after the first and
   the old limit was set when a stop could not be crossed at all.

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
