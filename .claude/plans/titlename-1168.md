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


## Iteration 7, the last one. Convergence, and the rule that decided it.

**I stated the stopping rule to Splinter BEFORE seeing any of iteration 7's output**, because a
termination criterion chosen after the result is just the result wearing a rule's clothes:

> only comment or coverage findings and no behaviour defect, I converge and write the proof; if it
> finds behaviour, I keep going, whichever answer comes back.

It returned **BEHAVIOUR DEFECTS: none**, having built both parsers side by side (main's regex
extracted verbatim against `identityFromText` on HEAD) and compared them on ~40 hand-picked shapes,
a ~30,000-case combinatorial fuzz, and all 84 real `CLAUDE.md`/`AGENTS.md` files on this machine. It
found no input where this branch fabricates a role main did not, and none where the name crosses a
sentence boundary main's did not.

**Behaviour has not changed since iteration 4. Iterations 5, 6 and 7 changed comments and tests
only.** That is convergence rather than stalling, and it is why seven iterations is not six too
many.

### The one finding in this diff, and it is the same class as the last one

`[A-Z]` in `NAME_PREFIX_RUN` widened to `[A-Z]+` left the **full suite green** while changing
output. So a second rule was stated in a comment and pinned by nothing:

```
You are IBM. He writes copy.   'IBM'  -> 'IBM. He'
You are HR. Manager, a role.   'HR'   -> 'HR. Manager'   role 'role'
You are CEO. Smith, a writer.  'CEO'  -> 'CEO. Smith'    role 'writer'
```

⭐ **Iteration 6 found the `Jr|Sr` exclusion untested; iteration 7 found the single-letter rule
untested. Both are rules ABOUT WHAT DOES NOT JOIN, and both survived every earlier pass.** The
pattern is worth naming: mutation kills what is present, and a rule about what is *excluded* has no
line to mutate, so a suite can be provably thorough about the inclusion list and blind to the
constraint beside it. Pinned with both arms, so it asserts "exactly one letter" and not merely "no
capitals".

### Rebased before finishing, and it mattered

The branch was **4 commits behind `origin/main`**, and the local `main` ref was stale and divergent
from it - missing `#1159` and `#1351`. So `git diff main...HEAD` showed six files when the authored
diff is three; the rest was inherited and already on main. **A review baseline that is not what will
be merged is not a review of what will be merged.** Rebased, re-ran: **2780 pass, 0 fail**.

### Deliberately not fixed here

Iteration 7 raised several findings in `engine/create.js` and `engine/discover.adopt.test.js`. **All
of them are inherited from commits already on `origin/main`, not authored by this branch**, so they
do not belong in this diff. Two were worth filing and are now #1359: the adopt test's two assertions
are both satisfied by the runner ARGUMENT and neither can see the binary path, and the test needs
the host's real codex to pass. Verified against `origin/main` before filing.

### One behaviour difference that is a decision, not a defect

`You are Anna the copywriter.` gives role `null` where main gave `copywriter`. **The comma rule is
worse than main on a no-comma prose role**, and iteration 7 named it plainly. It stays: it is the
card's declared standard, it is pinned in the test with an explicit "flip this row and say why"
escape hatch, and on the only real corpus available it fires 4 times and is right all 4. **If anyone
disagrees with the standard, that is the row to reopen** - the disagreement is about the standard,
not about the implementation.
