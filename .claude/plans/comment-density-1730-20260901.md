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

Median across 65 `engine/` modules: 2.14.

## What was cut, as a class

**Retraction narrative**: paragraphs describing what a previous version of that same
paragraph said and why it was wrong. Specifically: two withdrawn counts, a control
that shared its subject's blindness, a claim of four test arms that did not exist,
an asymmetry documented at three sites and believed unfixable until three reviewers
closed it, and two corrections bolted onto sentences instead of rewriting them, one
of which spliced itself between a subject and its verb while explaining that
splicing was the problem.

All of it is preserved verbatim on kosmos#1730, and the surviving comments point
there. **The pointer was made true before the code claimed it.**

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
- Result: 527 raw lines to 449, a reduction of 78. Ratios 2.37 to 2.04 and
  4.19 to 3.43.
- Full suite: one failure, `TypeError: fetch failed` / `ECONNRESET` in a first-run
  route, on a run whose own diagnostics recorded a live board on :16180 and
  1-minute load 7.67 on 10 cores. `server.test.js` alone: 252 pass, 0 fail.
  **Contention, and the byte-identical proof above is the stronger evidence.**

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
  becomes true again. Verified: the clause is at line 135, `ghPresent` is defined at
  206, so "the block above" resolves.
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

## Not done here

`engine/firstrun.js` is 3.95 and untouched. It was not part of the #1606 diff, so
it is pre-existing rather than something this work introduced. Cutting it is a
separate judgement about somebody else's comments and belongs to whoever owns it.
