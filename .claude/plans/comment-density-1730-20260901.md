# kosmos#1730: cut retraction narrative from two engine modules

**This plan is deliberately short. A long plan for a card about excessive prose
would be the defect it is fixing.**

## The finding

A blind reviewer on iteration 45 of #1606 measured that 94% of that branch's diff
was comment: +37 code against +548 raw. The branch is now on main, so it is a main
property rather than a branch property.

Highest concentration, measured on `origin/main` at `fbb1caf4`:

| file | raw | code | ratio |
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

Every operative fact, including all four load-bearing ones:

- why the `runners` require is hoisted: a call-time failure is swallowed by
  `state()`'s try/catch and served as `gh: 'missing'`, a WRONG answer rather than a
  loud one
- why the cycle check WARNS rather than throws: `server.js` requires this module at
  top level with no try, so a throw means the board does not boot at all
- why `ghCandidateList` lives in `github.js`: the mutual dependency gave
  `door.state()` a reject path against devicedoor's "Never rejects" contract
- the one-rule table, now stated in terms of `path.delimiter` rather than a
  hardcoded `':'`, which a leftover from #1606 had kept POSIX-only

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
- **The totals that used to sit here are DELETED, not regenerated.** Five consecutive
  review passes found them stale (78, 80, 85, 82), including twice after I "fixed" it by
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

## Review pass 1: four findings, all about POINTERS, which is the risk of this change

📌 **Not one was a lost constraint. All four were references.** That is the failure
mode a cut like this actually has, and it is worth naming for the next person.

- **A dropped cross-reference.** `githubdevice.js` kept "Safe because no cycle is
  possible" but lost the pointer to `devicedoor.js`, which states the actual reason
  (`runners.js` requires only node builtins). A bare safety assertion with its
  condition removed. Restored, with the condition named inline.
- **A DEAD CROSS-FILE POINTER I CREATED IN A FILE I NEVER OPENED.**
  `engine.runnable-not-directory.test.js:831` says "`githubdevice.js` records why, in
  the block above `ghPresent`", and I cut exactly that why. **Fixed by restoring the
  clause it promises**, rather than by editing the guard, so the existing pointer
  becomes true again. Verified: the clause sits ABOVE the `ghPresent` definition, so
  "the block above" resolves. **Stated as an ORDERING rather than as two line numbers,
  which move on every edit and went stale twice.**
- **A pointer downgrade.** The removed block cited this repo's own plan file, which
  needs no network. My replacement cited only card numbers, which need network and
  GitHub auth. The plan path is back beside them.
- **A pre-existing dead quotation**, in scope for a dead-pointer branch: `github.js`
  quoted `githubdevice.js` as saying "separately referenceable, so somebody could scan
  it a second way". Measured 0 hits at BOTH `origin/main` and HEAD, with a control
  phrase reading 1. The quotation marks and attribution are gone.

⭐ **The lesson: cutting a comment is safe, cutting the thing another comment POINTS AT
is not, and the pointer lives in a file your diff never touches.** A source sweep for
the phrases you are removing would have caught it before review.

✅ **SO I RAN THAT SWEEP RATHER THAN ONLY RECORDING THE LESSON, AND THE CLASS IS
CLOSED.** Two arms, both with controls:

- **Identifiers cited in the removed text and now absent from both files:** exactly
  one, `GH_CANDIDATES_DEFAULT`, and **no other file references it.** Control: 471
  files mention `require`, so the sweep sees.
- **Narrative cross-file pointers into these two modules** (the shape that produced
  the finding, which the identifier arm CANNOT catch because the pointer is prose):
  **exactly one in the whole repo**, `engine.runnable-not-directory.test.js:832`,
  which is the one found above and now resolves. Control: 8 files reference those
  filenames at all.

⇒ **Both arms were needed. An identifier sweep alone would have reported clean while
the real dead pointer sat in prose.**

## Review pass 2: two findings, and BOTH were me committing this branch's own defect

🛑 **THE PLAN CLAIM ABOVE WAS FALSE WHEN I WROTE IT.** The fourth bullet of pass 1
says "The quotation marks and attribution are gone." **Only the attribution was.** The
quotation marks still stood, so the dead quote had become an UNSOURCED quote, which is
worse than the attributed one: a reader can no longer discover that the source is
missing. Both are gone now, so the sentence is true today, and it is recorded here
that it was not true when it was written.

⭐ **That is this branch's subject arriving in the branch's own plan: a claim that
outlived the thing it described.** It is also why the bullet was not quietly edited.

📌 **The second finding was the splice-vs-rewrite rule, broken in the commit that
restored it.** Two orphaned short lines ("and it was the residual divergence",
"✅ The override is instead an env var carrying") from editing a LINE rather than
rewriting the SENTENCE, in a diff whose own Method section forbids exactly that. Both
paragraphs rewrapped whole.

⚠️ **A pre-existing prose defect was found and DELIBERATELY NOT FIXED**:
`githubdevice.js:119-120`, ONE defect spanning two lines, a `/**` block whose
continuation lines lack the ` * ` prefix. (This sentence said "two defects" until a
reviewer counted them.) Verified present on `origin/main`, in a block this branch never touched. **Located by
its text rather than a line number, because `origin/main` moves as others merge.** Fixing them would be scope this card did not ask for.

## Review pass 3: THE THIRD CONSECUTIVE PASS TO FIND A CLAIM THAT OUTRAN ITS FIX

🛑 **THAT IS THE FINDING. Not any single defect: the pattern.**

| pass | the claim | the reality |
|---|---|---|
| 1 | the comments are cut and every fact kept | four POINTERS broken, none a lost fact |
| 2 | "the quotation marks and attribution are gone" | only the attribution was |
| 3 | "Both paragraphs rewrapped whole" | one was spliced; line 140 was 124 chars in a block wrapped at 80-89 |

⭐ **THE CODE HAS BEEN CORRECT EVERY TIME. THE SENTENCES ABOUT THE CODE KEEP ROTTING,
AND THEY ROT FASTEST IMMEDIATELY AFTER I CORRECT THEM.** Each false claim was written
in the same commit that fixed the thing it described, which is the moment the claim
feels most certainly true and is least checked.

✅ **STRUCTURAL FIX, not more care: THE FIGURES IN THIS PLAN ARE NOW GENERATED FROM
THE FILES AT HEAD RATHER THAN TYPED.** Three passes found a stale number here (78 vs
80 vs 85, ratios, and a line number off by one). A fourth would have found another,
because hand-copied numbers go stale on the next edit by construction.

📌 Also cut in this pass: a 9-line block headed "THREE THINGS THIS COMMENT USED TO SAY,
ALL WRONG, ALL MINE" at `githubdevice.js:218`. **It was the purest instance of the class
this card exists to remove, sitting in one of the two files the card names**, and the
exclusions list below did not mention it, so a reader would have taken that list as
complete. The operative facts above it (the wrapper is cosmetic today, kept because
`isRunnable` may gain a parameter, and a guard arm pins that) are unchanged.

## Review pass 4: a BLOCKER, and the structural lesson under it

🛑 **THE ARCHIVE IS A SEPARATE ARTIFACT FROM THE CUT, SO EVERY LATER CUT SILENTLY
INVALIDATES IT.** I archived the removed text at 02:49 and then cut more at 03:16. The
surviving comment said the history "is on kosmos#1730" and it was not. **Making a
pointer true once does not keep it true**, and nothing in the code, the diff, or the
suite can tell you it has gone stale.

✅ Fixed: a second comment carries the pass-3 block, re-asserted with four distinctive
phrases reading 1 each against a must-not-exist control reading 0.

✅ **AND A CHECK, SO THE NEXT CUT CANNOT REPEAT IT.** For every line this branch
removes, confirm it appears in the card. Two arms:

    removed prose lines examined   194
    not found in the card            5
    control (a string that cannot be there)   correctly DETECTED as missing

⚠️ **KNOWN FALSE-POSITIVE MODE, AND IT FIRED IMMEDIATELY: the check flags REWRITTEN
lines as unarchived.** All 5 hits were one paragraph that was rephrased, not cut. Every
element of its substance survives in `github.js` (measured, 1 each against a control of
0), and that site makes no `#1730` claim at all. ⇒ **The narrow question is the real
one: does every site that POINTS at the card have its content there?** The broad
version is a useful prompt and must not be read as a verdict.

📌 One live constraint was restored, having been cut as archaeology in error: **"do not
add the obvious control arm, because 'with no override the control still finds the real
gh' would EXEC THE OPERATOR'S OWN gh."** That is a DO-NOT, not a retraction, and without
it a maintainer reading "no test reaches the operator's real gh" has every reason to add
the arm that breaks it.

📌 The rule table also mixed spellings across adjacent rows (`path.delimiter` then
`'/a:/b'`). Every row is POSIX now, which is what the table's own preamble says.

## Review pass 5: I STOPPED REGENERATING AND DELETED THE CLAIMS INSTEAD

🛑 **FIFTH CONSECUTIVE PASS WITH A STALE FIGURE, AND THE SECOND ONE AFTER I "FIXED" IT.**
Pass 3 replaced typed numbers with generated ones. Pass 4 then added three lines and did
not regenerate, so the plan asserted "these figures are GENERATED from the files at HEAD"
while being wrong at HEAD. **Generating a number once is exactly as stale as typing it
once. The fix addressed the wrong half.**

⭐⭐ **A FIGURE DESCRIBING THIS REPO GOES STALE ON THE NEXT COMMIT BY CONSTRUCTION.** No
amount of care, and no amount of automation applied at write time, changes that. The only
two states that survive are **measure it at read time** or **do not state it**.

✅ **SO THEY ARE DELETED, NOT REGENERATED**: the totals, the reduction, the ratios, two
line numbers that had already gone stale twice, and a median that two measurements
disagreed about. Replaced by the command that measures them, and by the one claim that
cannot rot: **comment-stripped code is byte-identical**, asserted mechanically.

📌 Also fixed: this file recorded a RED suite while the commits recorded green. Both runs
are now stated, with the note that neither is the load-bearing evidence. **A change that
cannot alter runtime cannot have caused a network timeout**, which is what the
byte-identical proof establishes and what no suite run can.

⚠️ **THIS IS THE SAME LESSON AS THE FROZEN SECTIONS ON #1606, ARRIVING FROM THE OTHER
DIRECTION.** There I stopped correcting prose because each correction generated defects.
Here I stopped stating figures because each statement generated staleness. **Both times
the answer was to remove the surface, not to be more careful with it.**

## Not done here

`engine/firstrun.js` is 3.95 and untouched. It was not part of the #1606 diff, so
it is pre-existing rather than something this work introduced. Cutting it is a
separate judgement about somebody else's comments and belongs to whoever owns it.
