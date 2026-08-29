# dropsplit-1493: one bucket held two situations, and only one is actionable

## Measured

Of the 17 folders on this machine that fail the `CLAUDE.md` read:

```
  working directory STILL EXISTS :  4    /, /Users/agent1, ~/.claude/channels
  working directory IS GONE      : 13    ~/work/workers/angeltest1315
                                         ~/work/workers/quiet-quill
                                         ~/work/workers/walk-avery
```

```
  FOLDER GONE     a deleted agent. Nothing to recover. Correct to drop.
  FOLDER PRESENT  possibly a REAL AGENT WE ARE FAILING TO SEE. Actionable.
```

⇒ **When somebody sends us their projects directory because their agents did not
appear, this split says in ONE LOOK whether it is our bug or their deleted
folders.** Without it the file arrives and we still cannot tell.

## ⚠️ And it corrects a sentence I wrote

`engine/discover.js` says a no-CLAUDE.md folder *"is what an ordinary folder
somebody once ran Claude in looks like, and a new install has mostly those."*

**On this machine that is 4 of 17.** I asserted the character of a population I
had only counted.

📌 **This Mac is not a new install**, so her ratio may invert. What is certain is
that the bucket conflates two things.

## 📌 Diagnostic only

`noInstructions` keeps its meaning and its value. **Nothing about what the screen
says changes**: what a person should be told is the product question #1493 is
already parked on. **These two counts are for us**, additive, reversible in a
commit, invisible to a user.

## Two counts, not one plus a subtraction

The invariant is why: **neither is derived from the other**, so
`gone + present === noInstructions` is a real check rather than an identity that
cannot fail.

The sum test also asserts **both halves are non-empty**, or the sum would hold
for a reason that has nothing to do with the split.

## Perturbed, four arms

```
everything counted as PRESENT    -> separate-counting test, red
everything counted as GONE       -> separate-counting test, red
the two halves swapped           -> separate-counting test, red
a folder falls OUT of the split  -> separate-counting AND the SUM test, red
```

**And the SUM test proven to fail on its own**, by putting one folder into both
halves: it fires without any help from the others.

## Cross-checked by two instruments written separately

A standalone probe reported **13 gone, 4 present**. The engine now reports **13
gone, 4 present**. Different code, same numbers.

Suite 2999 pass, 0 fail.
