---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: usemention-1570
diff_hash: aa1b1fc56e0457a70715e0f81e44e4d23605243c80efa83d6d32fbb6b406961d
subdir_audit: passed
timestamp: 2026-08-31T01:09:49Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes, plus a reviewer whose heuristic found the third artefact.

## [BLOCKER] (mine) My first fix reintroduced the card's defect in the opposite direction

I made the paraphrasing comment quote the message **exactly**. Measured immediately: one
phrase, **two hits** - the prose and the emit - so anchoring on the TRUE message became newly
ambiguous, which is precisely what this card is about --> FIXED: the comment now names where
the message is emitted and quotes none of it.

⭐ **Caught only because I counted after changing rather than reasoning that "exact quoting
must be safe".** It is obviously safe and it is wrong.

## [BLOCKER] (mine) My sweep for further instances was over-broad and I nearly reported 20

I built the "emitted strings" set from **one file's** `fail()` lines, then flagged every quoted
phrase in a comment that did not match it. **20 candidates. Exactly one was genuine.** The rest
were quoted CONCEPTS ("did a file land on disk", "keep the old behaviour") or real messages
emitted in files my set never looked at --> checked each survivor repo-wide before claiming
anything, and reported the false-positive rate rather than the raw list.

⇒ **That over-broad sweep is now the evidence FOR the card's own judgement** that this class
must not be auto-detected. A detector for it false-positives on exactly the careful comments
this codebase is full of.

## [STRENGTH] The card's own instance was sharper than the card stated

The searched sentence was not "one string in two places". **The product never emitted it at
all**, so the comment was the only match it had ever had. That changes the remedy from
"disambiguate two sites" to "a paraphrase in quote marks is a mention wearing a use's clothes".

## [STRENGTH] The dead regex arm was measured, not assumed

`/cannot find anything runnable|cannot find it where it should be/`. All three `fail()` calls
in `installClaudeCode` enumerated: none emits the second alternative. Removed, and the
remaining assertion **proven live** by perturbation - changing the emitted message reds the
test (16 pass 1 fail), and `engine/connect.js` was restored to its exact sha afterwards.

## Verification

| check | result |
|---|---|
| paraphrase `cannot find it where it should be` | 0 hits, tree-wide |
| real message `cannot find anything runnable...` | 1 hit, and it is a `return fail(` - a USE |
| `open Terminal and run claude` | 0 hits |
| `we could not confirm` (a real message) | 5 hits, untouched |
| perturb the emitted message | test **RED**, then restored to sha |

Full suite: **3225 tests, 3225 pass, 0 fail**, `SUITE rc=0`.

## Not done

**No mention detector, and the card must not be closed on this.** It says it is worth a card
rather than a fix; my 20-versus-1 measurement is the number that supports it. Three live
artefacts fixed, class untouched.
