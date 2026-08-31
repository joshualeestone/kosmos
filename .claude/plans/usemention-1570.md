# #1570: the two live artefacts of the use-versus-mention incident

**Branch:** `usemention-1570` · **Card:** kosmos#1570, filed by two agents who hit the class
ninety seconds apart.

## 🛑 The card's instance 1 is sharper than the card says, and the difference changes the fix

The card says the searched string *"also appears in a comment two hundred lines earlier"*.
Measured:

```
"cannot find it where it should be"                  connect.js:1340      a COMMENT
                                                     install-997.test.js  a test regex arm
"cannot find anything runnable where it should be"   connect.js:1382      the REAL fail()
```

⇒ **The product never emitted the sentence that was searched for.** It was not one string in
two places; it was a **paraphrase that existed only in a comment**, written inside quotation
marks so it read as a quotation of real output. The backward search was not choosing between
candidates - **the comment was the only match there had ever been.**

## Two live artefacts, both fixed

1. **The paraphrasing comment.** It now names where the message is emitted and quotes **none**
   of it.
2. **A dead regex alternative** in `connect.install-997.test.js`:
   `/cannot find anything runnable|cannot find it where it should be/`. Measured against the
   three `fail()` calls in `installClaudeCode`: **none emits the second alternative**, so that
   arm could never fire. Removed. It was not harmless - it made the assertion look like it
   covered two messages when one of them does not exist.

## The mistake I made while fixing it, which is the same defect pointing the other way

My first fix made the comment quote the message **exactly**. Measured: one phrase, **two hits**
- the prose and the emit - so anchoring on the true message became newly ambiguous. **I had
reintroduced the card's own defect in the opposite direction.**

⇒ **A comment about a message should name WHERE it is emitted and quote none of it.** Quoting
exactly is not the fix; it just moves the ambiguity.

## A third instance, found with a heuristic and worth more than it

Splinter's rule: **when a search for a user-facing string returns exactly ONE hit, suspect it -
a real message usually appears at its emission site AND in a test. One hit means you have
probably found a mention.**

Applied to `connect.js`: `"open Terminal and run claude"` had **one hit, comment-only**. It is
a remedy *described* in quote marks; no code emits it, and there is a test asserting the wizard
never instructs anybody to open a Terminal. De-quoted. Its neighbour `"we could not confirm"`
keeps its quote marks, because it **is** emitted verbatim (5 hits).

⚠️ **And my own sweep for this was over-broad, which is worth recording:** it flagged **20**
candidates in that file, of which almost all were quoted *concepts* ("did a file land on disk",
"keep the old behaviour") and several were real messages my `emitted` set had missed because I
built it from one file's `fail()` lines. **Exactly one of the twenty was genuine.** That is
strong evidence for the card's own judgement that this class should not be auto-detected.

## Not done, deliberately

**No mention detector, and this card should not be closed on my work.** The card says it is
worth a card rather than a fix, and my 20-candidate sweep is the measurement that supports it:
distinguishing a use from a mention automatically false-positives on exactly the careful
comments this codebase is full of. **I fixed three live artefacts, not the class.**
