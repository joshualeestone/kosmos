# kosmos#1730: cut retraction narrative from two engine modules

**This plan is deliberately short. A long plan for a card about excessive prose
would be the defect it is fixing.**

## The finding

A blind reviewer on iteration 45 of #1606 measured that 94% of that branch's diff
was comment: +37 code against +548 raw. The branch is now on main, so it is a main
property rather than a branch property.

Highest concentration, measured at the branch's merge base `fbb1caf4`:

| file | non-blank | code | ratio |
|---|---|---|---|
| `engine/github.js` | 88 | 21 | 4.19, highest in `engine/` |
| `engine/githubdevice.js` | 439 | 185 | 2.37 |

Both were well above the `engine/` median. **The exact median is deliberately not
quoted**: it depends on whether test modules are excluded, and two measurements of it
disagreed (65 modules / 2.14 and 67 / 2.19).

## What was cut, as a class

**Retraction narrative**: paragraphs describing what a previous version of that same
paragraph said and why it was wrong. Specifically: two withdrawn counts, a control
that shared its subject's blindness, a claim of four test arms that did not exist,
an asymmetry documented at three sites and believed unfixable until three reviewers
closed it, and two corrections bolted onto sentences instead of rewriting them, one
of which spliced itself between a subject and its verb while explaining that
splicing was the problem.

All of it is preserved verbatim on kosmos#1730, and the surviving comments point there.

🛑 **THAT SENTENCE USED TO END "The pointer was made true before the code claimed it",
AND A BLIND REVIEWER FOUND IT FALSE AS A BLOCKER.** It was true for the first batch,
archived at 02:49 before the first commit. **It was false for the block cut in pass 3
at 03:16**, which was never added, so `githubdevice.js` pointed at a card that did not
contain it. Measured at the time: 0 hits for every distinctive phrase, against a control
phrase from the first batch reading 1. A second comment now carries it, re-asserted with
the same probes reading 1 and a must-not-exist control reading 0.

⭐ **The archive is a SEPARATE ARTIFACT from the cut, so every later cut silently
invalidates it.** Making the pointer true once does not keep it true. That is the
branch's own defect class, committed inside the fix for it, and boasted about in the
sentence that was wrong.

## What was kept

📌 **Stated as facts about the file AS IT NOW STANDS, not as descriptions of what I
changed.** Every review pass so far has found a false summary of my own edit, including one
here: "the table is now stated in terms of `path.delimiter`" when the table's rows were
untouched and only a line above them was added. **A sentence about what I DID encodes
what I believe I did. A sentence about what the file SAYS can be checked against it.**

Every operative fact, including all four load-bearing ones:

- why the `runners` require is hoisted: a call-time failure is swallowed by
  `state()`'s try/catch and served as `gh: 'missing'`, a WRONG answer rather than a
  loud one
- why the cycle check WARNS rather than throws: `server.js` requires this module at
  top level with no try, so a throw means the board does not boot at all
- why `ghCandidateList` lives in `github.js`: the mutual dependency gave
  `door.state()` a reject path against devicedoor's "Never rejects" contract
- the one-rule table. Its rows spell the separator `':'`, and a line above them says
  the spellings are POSIX and become `';'` on Windows

Also kept: the warning that `engine/vercel.js` keeps a bare literal so the switch
does not generalise, and the deferred design note that passing candidates as a
parameter is the genuinely closed form, left undone because it is an API change on
Josh's product surface.

## Method, and why it is the safe one

**Cut whole blocks. Never repair a sentence.** That rule came out of nine
consecutive review passes on #1606 where the largest source of findings was the
previous pass's own correction. Deletion cannot create a fragment; splicing and
rewrapping can.

## Verification

- **Comment-stripped code is byte-identical at both revisions**, proven by sha256
  on the stripped text, with a control showing the instrument detects a
  one-character change. ⇒ This change CANNOT affect runtime behaviour.
- Code line counts asserted unchanged: `githubdevice.js` 185, `github.js` 21.
- **The totals that used to sit here are DELETED, not regenerated.** Review passes kept
  finding them stale (78, 80, 85, 82), and a later pass found a figure I had
  claimed to have deleted, including twice after I "fixed" it by
  generating them instead of typing them. **Generating a number once is still a snapshot,
  and a figure describing this repo goes stale on the next commit BY CONSTRUCTION.**
  ✅ Measure it at read time instead, which cannot go stale:

      git diff origin/main --stat -- engine/githubdevice.js engine/github.js

  📌 The only durable claim is the invariant, and it is asserted mechanically below:
  **comment-stripped code is byte-identical**, so the code line counts did not move.
- **Suite, and both runs are stated because one contradicted the other in this file.**
  The FIRST run (at the initial cut) was red: one `TypeError: fetch failed` / `ECONNRESET`
  in a first-run route, on a run whose own diagnostics recorded a live board on :16180 and
  1-minute load 7.67 on 10 cores. Every run since has been `EXIT_CODE=0`, 3396 pass, 0 fail.
  ⭐ **The byte-identical proof is the load-bearing evidence, not either run**: a change
  that cannot alter runtime cannot have caused a network timeout.

## The review passes are on kosmos#1730, not here

**Every blind pass so far has found something in this plan or in my claims about it.
Not one has found anything in the code**, which has been byte-identical throughout.

📌 **The count is deliberately not stated.** It went stale the moment another pass ran,
and a reviewer caught this file contradicting itself about it. "Each pass so far" cannot.

🛑 **THE PASS-BY-PASS NARRATIVE THAT USED TO SIT HERE IS CUT, AND CUTTING IT IS THE
POINT.** It was archaeology about my own archaeology-removal, in the plan for the card
that removes archaeology. Every pass found a false claim in it, each time in a sentence
written by the commit that fixed the previous one.

⭐ **The sequence, because it is the only durable finding:**

| pass | the claim | the reality |
|---|---|---|
| 1 | cut cleanly, every fact kept | four POINTERS broken, no lost fact |
| 2 | quotation marks and attribution gone | only the attribution was |
| 3 | both paragraphs rewrapped whole | one was spliced |
| 4 | the archive was made true before the code claimed it | true for the first cut, false for the second |
| 5 | the figures are generated, not typed | not regenerated after the next commit |
| 6 | the figures are DELETED | three survived |

⇒ **Each fix was correct and each summary of it was false within one pass.** The defect
was never the figures or the prose. It was writing a SUMMARY CLAIM about work I had just
done, at the moment it feels most certainly true and is checked least.

✅ **So the summaries are gone rather than corrected a seventh time.** What remains above
is the operative plan: what was cut as a class, what was kept, the method, and one
mechanical invariant. The full pass-by-pass record is on kosmos#1730 where it cannot go
stale against a moving file.

📌 This is the #1606 frozen-sections decision reached again by a different road, and
faster: there it took nine passes, here six.

## Not done here

`engine/firstrun.js` carries a comparably high comment ratio and is untouched. **The
number is deliberately not quoted here**, for the reason the section above gives: an
unanchored figure about a live file goes stale on the next commit, and a reviewer caught
exactly that one surviving my claim to have removed them all.

It was not part of the #1606 diff, so it is pre-existing rather than something this work
introduced. Cutting it is a separate judgement about somebody else's comments and belongs
to whoever owns it.
