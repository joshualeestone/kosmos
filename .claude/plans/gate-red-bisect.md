# The browser gate red on main: assertions keyed on a step that moved

Branch `gate-red-bisect`. Blocks the 0.6.21 cut and every cut after it, so
167 commits including Josh's number one card cannot reach anybody.

## What happened

`#1214` (07395e81) inserted Accessibility as first-run step 5, moving every
later step up one. `#1652` (3826baf5) added a fourth create-agent radio.
Neither touched a browser check.

Five checks went red. **More were wrong and stayed green, and the count kept
going up as the branch went on** -- five found by reading, then three more
(the ending screenshot rows) found only by a blind review of the fix itself.
⇒ **A blast radius measured from the RED LIST is a lower bound, and so is one
measured from your own first sweep.**

## The five reds

| check | cause | kind |
|---|---|---|
| render-role-order | asserts 3 radios, 4 exist | stale, #1652 |
| render-found-undo | `fr-step=6`, `#fr-fleet` is in pane 7 | stale, #1214 |
| render-found-count | same, two sites | stale, #1214 |
| click-first-run | 5 segments, step-5 About-you, 4 clicks | stale, #1214 |
| **render-fields** | **`#import-text` has no fill of its own** | **REAL, carded #1800** |

## The ones that were green and wrong

Each fails to fail for a different reason, which is why no single guard
catches them.

- `render-first-run.js:518` read `fr-pane-6` while its comment called it "the
  LAST step". It passed because its assertions are "at least 20 characters"
  and "no Dock mention", both true of About-you. **Loose assertions are what
  let a misaimed check keep passing.**
- `click-first-run.js` pinned the crumb `of 5`. `index.html` builds
  it as `(FR_STEPS - 1)`, so it is `of 6` and the regex can never match.
  **Masked by an earlier failure in the same file.**
- `click-first-run.js` x3 waited for `#fr-pane-5` to hide to detect leaving
  About-you, which is pane 6 now. **A wait for something already true
  resolves at once and cannot fail.** ⚠️ REASONED FROM SOURCE, NOT MEASURED:
  the file reds upstream of that arm, so I could not watch it run.
- `click-first-run.js` looped `[2..6]` under a comment saying "every
  step". **A loop that omits an element cannot fail.**
- `render-first-run.js:170` (a line number into **`origin/main`**, not HEAD)
  shot `firstrun-5-about-you` at step 5, which is
  Accessibility now.

## Two more, found only after the first fix was verified

My first sweep grepped the SPELLINGS I had seen (`fr-step=`,
`shape.count === 3`) rather than the SHAPES:

- `click-first-run.js` carried the fourth-radio defect behind a different
  selector (`#roles-list .pick2:visible`).
- `click-first-run.js` encoded the inserted step as A NUMBER OF CLICKS,
  which an index sweep cannot see at all.

Re-swept by shape: every multi-click `fr-next` run (5,3,5,3), every
`count()===N`, every `fr-step=`.

## What was measured

🛑 **THIRTY OF THE THIRTY-TWO ROWS BELOW WERE MEASURED ON SHAS THAT ARE NO
LONGER ON THIS BRANCH.** Measured 2026-09-02 with `git merge-base
--is-ancestor` on every sha in the table, with both controls: **runs 1
(`5e328edd`) and 32 (`08fd5c68`) are still ancestors of HEAD; the other thirty
are not.**

⚠️ **AND THIS SENTENCE WAS ITSELF STALE FOR TWO COMMITS, WHICH IS THE POINT OF
THE SECTION HAPPENING TO THE SECTION.** It read "thirty of the thirty-ONE" and
"only run 1", both true when written and both falsified by the commit that
ADDED row 32 -- the same commit, again, that invalidated row 32's own claim.
⇒ **A denominator is a measurement too.** Re-count it, do not carry it. The branch was rebased onto
`07c11fa4` that morning and every commit was rewritten.

⚠️ **THIS SECTION PREVIOUSLY SAID IT APPLIED TO RUNS 2 AND 3 ONLY, AND THAT
"RUNS 4 AND 5 ARE" EVIDENCE. That sentence was true when written and false
four hours later**, which is the whole hazard: a results table is a claim about
a moment, and nothing in it changes appearance when the moment passes.

🛑 **AND IT IS WORSE THAN LOST ANCHORS.** The natural assumption is that the
runs are merely un-anchored: same code, new shas. **They are not.** The rebase
CHANGED an executed check -- `render-model-change.js` went from 289 lines to
398 -- so **the fourteen green runs measured a DIFFERENT VERSION of a check
that is still in the suite.** The old rows are genuinely stale, not renumbered.

⚠️ **A CORRECTION I PUBLISHED FLEET-WIDE AND THEN HAD TO RETRACT, KEPT HERE
BECAUSE THE MISTAKE IS MORE USEFUL THAN THE CLAIM.** I first wrote that the
rebase pulled in a **new** check that had never run. It had run, in all
fourteen. `git diff --stat` showed `109 ++++++++` with no deletions and I read
that shape as "new file" **without asking git whether it was new**.
`git diff --name-status` answers it in one letter: **`M`, not `A`.**
⇒ **The diff-the-executed-files test reports THAT executed content changed. It
does not say whether a check was added, modified or deleted, and I supplied
"added" out of my own expectation.**

✅ **THE TWO QUESTIONS, AND THEY ARE DIFFERENT.** The first is cheap and the
second is the one that decides whether a measurement survives:

```
git merge-base --is-ancestor <sha> HEAD          # is the row still anchored?
git diff --name-only <old-base>..<new-base> -- \
  'docs/browser-checks/*.js' tools/browser-checks.sh web/index.html
                                                 # 0 = the MEASUREMENT survives
```

🛑 **`web/index.html` IS IN THAT LIST AND IT WAS MISSING WHEN THIS WAS FIRST
WRITTEN AND PUBLISHED FLEET-WIDE.** A browser check's result is a function of
the CHECK **and the PAGE it drives**. Scoping the set to the checks alone means
a product fix lands, every check now drives a different page, and the instrument
reports that nothing moved.

✅ **PROVED WITH A CONTROL, not reasoned.** Commit `67d0d08a` is the #1835 fix;
it changed `web/index.html` and no check file:

```
the checks-only rule over 67d0d08a   -> 0    "the measurement survives"
what it actually changed             -> web/index.html, +18 lines
the corrected rule                   -> 1    catches it
```

⚠️ **AND THE OLD RULE IS RIGHT TODAY BY ACCIDENT**, which is the shape worth
naming: for the rebase actually in front of this branch it returns 4, so it
gives the correct answer for the wrong reason. The failure only appears on a
rebase that touches the page and not the checks, **which is precisely the shape
a product fix has.**

⭐ **THE GENERAL FORM: the executed set is everything the run READS, not
everything the run IS. A test's inputs include its subject.**

⭐ **An orphaned sha whose executed content is unchanged is still a valid
measurement.** Measured both ways here: **0** for the rebase ahead of this
branch, **1** for the one behind it, and that 1 is `render-model-change.js`.
The instrument can return the dangerous answer.

📌 **So rows are keyed on a CONTENT HASH of the executed set from now on, not
only on a commit sha.** The sha says where the run happened; the content key
says what it measured, and only the second one survives a rebase.

| run | frozen at | on this branch? | result |
|---|---|---|---|
| 1 | `5e328edd` | yes | five reds reproduced (my edits were UNCOMMITTED and invisible, so it measured nothing of mine) |
| 2 | `ef3a3380` | **no, pre-rebase** | role-order, found-undo, found-count PASS; click-first-run and render-fields FAIL |
| 3 | `a8fab7c8` | **no, pre-rebase** | all four stale checks PASS; render-fields the only failure |
| 4 | `ed2b5f57` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`** |
| 5 | `3cd64e22` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`** -- the run that first exercised the new `firstrun-5-accessibility` and `firstrun-7-*` rows |
| 6 | `190d393a` | **no, orphaned by the 09-02 rebase** | **NO VERDICT. The run DIED**, see below. Not evidence either way |
| 7 | `2e796de7` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, and independently recorded in `~/.local/log/kosmos-browser-runs.log` |
| 8 | `3eed982c` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 9 | `eeb2feb6` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 10 | `7ed0076a` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 11 | `f1c5bb93` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 12 | `154cf05e` | **no, orphaned by the 09-02 rebase** | 🛑 **RED. `render-first-run` FAILED** on `ReferenceError: problems is not defined`. See below |
| 13 | `bb19e7c7` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`** -- the scope break fixed, `render-first-run` PASS |
| 14 | `0d4807c6` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 15 | `e5b54451` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 16 | `6772ae5c` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 17 | `cbd9348a` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`** -- the run that first exercised the three `FR_FOUND` settle conditions, with no settle finding emitted |
| 18 | `fbf4671f` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, and the new label assertions fired 7 times |
| 19 | `af158462` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 20 | `b5a7d43a` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 21 | `a09ee283` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, and the reworked Skip and action-bar assertions each fired 7 times |
| 22 | `2f9be18b` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 23 | `06f2eab0` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, all six ending shots written, zero settle failures |
| 24 | `dd7ce374` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 25 | `91b4956b` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 26 | `c05bc603` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 27 | `5ca30108` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 28 | `69f9a388` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 29 | `808a1969` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 30 | `7520dd0b` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 31 | `4f9b4ce7` | **no, orphaned by the 09-02 rebase** | **56 ran, 0 failed, 0 retried, `all page checks passed`**, likewise in the durable log |
| 32 | `08fd5c68` | **SUPERSEDED BY ITS OWN COMMIT, see below** | **56 ran, 0 failed, 1 retried (render-agent-nav, passed on retry), `all page checks passed`**; executed-set content key `86c3f9133dff1b36` |

🛑 **RUN 6 DIED AND ITS LOG CONTAINED ZERO `FAIL` LINES.** A grep for failures
read clean on a run that never finished. What it lacked was the terminal
verdict, which is printed only on the exit path, and an entry in the durable
run log, which is written just before it. **Absence of FAIL is not a pass**;
read the verdict line, or the durable log, or both.

**Cause, reproduced with a control: I edited `tools/browser-checks.sh` while it
was running.** bash reads a script incrementally by byte offset, so the edit
made it resume mid-token and report a syntax error against a line that is
correct in every version of the file. Carded as **#1818**.

⇒ ⭐ **The freeze protects the CHECKS and cannot protect the RUNNER**, because
the runner executes from the path you invoked. `tools/browser-checks.sh` is the
one file in this repo where a mid-run edit is fatal, and the failure is
unattributable if you do not know that.

📌 **`render-fields` PASSES from run 4 onward.** #1800 (the `#import-text`
fill) landed on main between run 3 and run 4. **The gate is GREEN on this
branch, not green-except-one**, and any reading of this plan that says
otherwise is reading rows 1 to 3.

⚠️ Run 1 measured nothing: `browser-checks.sh` freezes a detached copy of
the LAST COMMIT. It says so in the log and I filtered that line out by
grepping for PASS and FAIL. **Read the `Frozen at <sha>` line and assert it is
your sha.**

## Decisions

**Re-pinned indices rather than keying on identity.** Identity-keying means
each check discovers its own pane before navigating: a bigger diff, in five
files, with a release blocked. Carded as #1801. Only `render-role-order` is
identity-keyed **in how it NAVIGATES**; it pins the value **SEQUENCE**, not a
set (`values.join(',')` is order-sensitive, so a pure reorder reds).

🛑 **THAT DECISION DID NOT SURVIVE THE REVIEW, AND THE PLAN SHOULD SAY SO
RATHER THAN READ AS IF IT HAD.** Re-pinning numbers is what the branch STARTED
with. Three blind reviews took it apart in the same way each time: a correct
number with no identity assertion is the identical check one renumber later.
The branch now carries identity arms in `render-found-undo`,
`render-found-count`, `click-first-run` (an `arrivedAt` helper, and a
`leftAboutYou` helper) and `render-first-run` (`STEP_EYEBROW`, asserted on
every shot), plus sites that read the page's own `FR_STEPS` / `FR_STEP_YOU`
instead of pinning a literal.

📌 **NO COUNTS IN THAT SENTENCE, ON PURPOSE.** It said "four files ... plus two
sites" and went stale in the very commit that added two more. **A branch whose
thesis is that a count is what goes stale should not ship one.**

🛑 **AND IT TOOK TWO GOES.** The rewrite that removed those counts introduced
"at four walks, plus three more" one line further on, directly beneath the note
saying the counts had been removed. **Writing the rule into the paragraph did
not stop me writing the defect into the same paragraph.**

⚠️ **AND THE RULE HAS AN EDGE WORTH KNOWING: `FR_EYEBROWS` IS MIRRORED, NOT
READ.** It is declared inside `frGo`, so it is unreachable from
`page.evaluate`; applying derive-do-not-pin to it raises a ReferenceError.
`FR_STEPS` and `FR_STEP_YOU` are top-level and are read from the page.

⇒ **#1801 is narrower than it was: what remains is navigating by identity, not
asserting it.**

**What was added instead:** every one of these now fails LOUDLY. The class
that hurt us was silent passes, and that is gone from all of them.
`render-found-undo` asserts the step it landed on by name.

**`render-fields` was not fixed here, and did not need to be.** It is a
product defect in #1652, and a product fix buried in a check-update PR is how
it ships unnoticed, so it went to #1800 and to Mona Lisa. **#1800 has since
landed and `render-fields` passes** -- the decision working, not a loose end.

## Corrections made during the review, kept here rather than in the code

**These live in the plan on purpose.** A correction narrated inside the file it
corrects becomes the next reader's finding: it describes a state that never
shipped, and it competes with the code beside it.

1. **I bumped a comment about the "return step" from 6 to 7 and attached #1214
   to it. The return step is STEP 1** (`FR_STEP_RETURN = 1`) and never moved.
   The original was already stale, and my edit made it worse: **a wrong claim
   with a card number on it reads as freshly checked.**
2. **Moving about-you from step 5 to 6 put FOUR shot rows on step 6 at once**,
   so three ending shots silently photographed About-you. Fixing one row of a
   positional array can collide it with the rows below.
3. **I made two accounts of one measurement contradict each other**: the check
   header was made honest ("measured at `?fr-step=6` ... BUMPED, not
   re-measured") while the runner's copy of the same claim was silently bumped
   and still said the header agreed with it.
4. **Adding a shot row staled a count in the sibling README** ("fifteen
   first-run states"). Fixed by removing the number rather than by correcting
   it, since the number is what goes stale.
5. **Every new failure message asserted ONE cause** (a renumber) for a
   condition with three (renumber, eyebrow copy edit, overlay never opened).
   All now name the alternatives and print what they saw.
6. **I fixed one stale count in a file and left its sibling three lines of the
   same table away** (the README's "fifteen first-run states" got fixed, its
   "three role options" did not), and **swept `tools/browser-checks.sh` for
   stale step claims and stopped one hunk short.** A sweep that starts from the
   thing you just changed stops where your attention does.
7. **Re-pinning kept coming back after I had decided against it.** Three
   separate sites still carried a literal after the decision was made: the
   crumb regex, the segment count, and three `#fr-pane-6` hidden-waits. **A
   decision recorded in a plan does not apply itself to the code.**
8. **The renamed `firstrun-7-*` rows could still photograph the wrong screen.**
   The create arm paints twice and both paints are step 7, so the eyebrow arm
   cannot separate them. **Renaming the row fixed the name and not the
   picture**, and only a wait for the settled ending fixes the picture.
9. **The guard I added for (8) was itself keyed on `shot.step === 7`** -- the
   position-keying this whole branch exists to remove, committed inside the fix
   for a position-keying bug. It is now a `settle` flag on the row.
   🛑 **SUPERSEDED BY ITEM 16, AND THIS LINE WAS LEFT READING AS PRESENT-TENSE
   SHIPPED CODE.** There is NO `settle:` field on any SHOTS row at HEAD
   (measured: zero occurrences), and `render-first-run.js` now argues the
   opposite in terms -- the wait is UNCONDITIONAL precisely because gating it on
   a per-row flag is an omission mode. ⇒ A reader trusting this sentence goes
   looking for a flag, or restores one. **A correction log has to mark its own
   reversals, or the earlier entry keeps making the claim.**
10. **A comment I added cited `click-first-run.js`, and the line moved to
   283 inside this same branch** -- forty lines below the rule I had just
   written saying to cite by name because a line number goes stale.
11. **The derived crumb regex re-acquired the defect it replaced.**
   `[1-${frSteps - 1}]` is correct only while that value is one digit; at ten
   steps it becomes a range plus a literal and can never match. Deriving a
   value does not make the expression around it safe.

12. **The `settle` wait's failure message said "after 5s" while its timeout
   said 10000**, three lines apart, in the branch whose thesis is that a stale
   claim beside correct code is the defect. Both now read one constant.
13. **The wait I added for the three ending ROWS was not added to the fourth
   site that lands on the same step** (the LAST-step block), which stubs no
   route and so is the site most exposed to the interim paint.
14. **`leftAboutYou` re-opened the hole it closed.** Playwright treats a
   DETACHED element as hidden, so a pane id naming nothing satisfies the wait
   instantly. **Deriving the selector removed the stale literal and not the
   silent no-op**; it now asserts the pane exists first.

15. **The floor I put in to replace an exact count was worse than the count.**
   I loosened `=== 4` to `>= 3` on the visible role options and justified it by
   saying the SET was pinned in `render-role-order.js`. **That was false**: the
   sibling reads the DOM, which is static markup, and never asserts the options
   RENDER. And `>= 3` sits on an unreachable value, since two of the four ship
   hidden and are revealed together, so the count is 2 or 4 and never 3 -- **a
   floor that was `=== 4` in disguise while silently accepting a lost option.**
   Now derived: every mode that exists must be visible.
16. **`settle` was an opt-in flag that nothing validated.** It replaced a step
   number, which was right, with a thing a future author must remember, which
   is the omission mode that caused the original defect twice on this branch.
   The wait is a no-op on every other screen, so it now runs unconditionally.
17. **Nothing asserted that SHOTS covers every step.** The branch's headline
   finding is that a missing row asserts nothing and cannot fail; the missing
   row was added BY HAND and no guard was added against the next one. There is
   one now, read from `FR_STEPS`.

18. **An assertion I added would have RED THE GATE ON A LEGITIMATE PAGE.** I
   made "every role option is visible" a hard requirement; `index.html`
   documents the `!OWN_ROLE` state, where two of the four are deliberately
   hidden, as supported. **A false red in a release gate costs the next person
   hours hunting a defect that does not exist.** Now asserts the invariant
   (own and import are offered on the same condition) rather than the count.
19. **A comment survived the code it described by one commit.** Removing the
   `settle` flag left the paragraph explaining why `settle` was the right
   design, directly above the paragraph explaining why it was not.

20. 🛑 **THE try/finally I ADDED IN ITERATION 8 BROKE THE CHECK, AND IT WOULD
   HAVE RED THE RELEASE GATE THIS BRANCH EXISTS TO UN-RED.** `const problems =
   []` went inside the `try`, while the summary and `process.exit` sit after
   the `finally`, so every run ended in `ReferenceError: problems is not
   defined`.

   ⚠️ **`node --check` PASSES ON IT.** It is a runtime scope error, not a
   syntax error, so the per-file syntax check I had been running after every
   edit all night could not see it. **Gate run 12 caught it, and a blind
   reviewer caught it independently in the same window.**

   ⭐ **The fix was hardening.** I added a `try/finally` so a throwing guard
   could not leak a browser. It was the right change and I made it wrong, and
   the thing that caught it was running the gate rather than trusting the
   review or the syntax check.
   ⇒ **A green `node --check` is not evidence a check RUNS.** Run it.

21. **THREE FALSE CLAIMS ABOUT SIBLING FILES, IN ONE COMMIT.** I wrote that
   "every sibling check in this directory" carries a THREW catch (**measured: 3
   of 63**); that `render-fields` carries "the same fix" (**it has a
   try/finally and no catch**, so it carries a third of it); and that
   `render-role-order` catches the both-options-hidden case (**it reads
   `input[name="rmode"]` with no visibility filter, so it cannot see it**).

   ⭐ **A claim about ANOTHER file is the cheapest thing to write and the most
   expensive to check, so it is the one nobody checks.** A reader who trusts
   "every sibling does this" concludes no sibling needs the fix. All three were
   written in the commit whose stated purpose was removing false claims.
   ✅ **The rule I should have been following: do not describe a sibling file
   you have not just measured.** Each of these took one command to settle.

22. **A FOURTH false coverage claim, and this one about the file it was in.** I
   wrote that a DOM-presence count catches the case where both optional role
   modes are hidden. **A presence count is blind to visibility**, so it catches
   nothing of the sort; and the count itself cannot fail, because the labels are
   static markup that only ever has `.hidden` toggled. **A vacuous assertion
   under a false comment reads as coverage twice over.** Removed rather than
   rewritten: there was nothing there to keep.

23. **A WAIT I ADDED COULD NEVER BE SATISFIED, AND `.catch(() => {})` HID IT.**
   I settled the Tab-trap loop on the return placeholder clearing. But
   `frPaintReturn` has ONE call site (the step-1 branch) and `frGo` retires its
   answer by generation on every other step, so off that step the placeholder
   never clears: the wait burned its full 8 seconds on six of seven iterations
   and protected nothing. ⚠️ **A swallowed timeout is invisible by
   construction** -- the run just takes longer.
24. **A FIFTH false claim about siblings, in the sentence written to REPLACE
   the numbers.** I removed "3 / 36 / 24" because a hand-maintained count rots,
   and wrote "a few have a top-level catch ... many have neither". **Measured:
   37 of 63 have one, which is the MAJORITY, not a few.** ⇒ **Swapping a number
   for a magnitude word does not make an unmeasured claim safe; it just makes it
   unfalsifiable.** The sentence now points at the grep instead.

25. **A COMMENT STATED A FIXTURE PREMISE THAT IS FALSE, AND THE WAIT UNDER IT
   WAS VACUOUS BECAUSE OF IT.** I wrote that the LAST-step block runs on a board
   with no agents and therefore paints "Looking for agents". **`boot_board`
   calls `write_fleet`, which seeds two panes**, so it takes the ADOPT arm and
   never paints that at all: the wait's only condition could never be false.
   ⇒ **A wait is only as good as your model of the fixture**, and the fixture
   was two function calls away in the runner.
26. **I replaced a vacuous assertion with a different vacuous assertion.** The
   floor `everyStep.length > 0` could not fail, so I made it
   `everyStep.length === frStepsHere` -- **two `page.evaluate` reads of the same
   `FR_STEPS` compared against each other.** Removed: the loud failure was
   already there, as a ReferenceError from the read itself.
27. **THE POINTER MEASURED A DIFFERENT PROPERTY FROM THE CLAIM.** Told not to
   ship a count, I wrote "grep for `)().catch(`" -- which counts terminal
   catches (37 of 63, common) while the sentence was about in-run throw-to-
   finding catches (rare: **2** of 63 on `main`, 6 of 63 after this branch -- the
   figure here read "3 of 63" and disagreed with `render-role-order.js`, which
   said 2; measured `git grep -ln THREW origin/main`, the answer is 2,
   `click-first-run.js` and `render-thread.js`). ⇒ **Replacing a number with a pointer is
   only honest if the pointer answers the same question.**

28. 🛑 **I MULTIPLIED AN ASSERTION THAT COULD NEVER FAIL BY SEVEN.** The check
   counted `#fr-back` and `#fr-skip` and asserted the count was 0. The count is
   0 whatever happens, and I widened it to every step believing I was
   strengthening coverage.

   🛑 **AND MY FIRST EXPLANATION OF WHY WAS WRONG, WHICH IS THE BETTER
   FINDING.** I said the ids had never existed. **They did**: both are in
   `web/index.html` at `cb28d7c2`, the very commit the check cites, and they
   were later deleted. I had grepped `main` -- THE PRESENT -- and published a
   claim about THE PAST, with a passing positive control that proved the
   instrument and said nothing about the scope of the claim.
   ⇒ ⭐ **A VACUOUS ASSERTION IS USUALLY NOT WRITTEN VACUOUS. IT IS WRITTEN TRUE
   AND ROTS WHEN THE MARKUP IT NAMES IS DELETED** -- and then somebody widens
   it. That is a recurring mechanism, not carelessness.
   ⇒ **The wizard builds exactly `#fr-next` and `#fr-alt`, so a reintroduced
   Back would arrive as one of those.** The assertion now reads their LABELS,
   which can return the dangerous answer.
   🛑 **AND IT CAME BACK ON 2026-09-02.** The rebuild onto Renet's #1801 silently
   dropped this rewrite and restored the vacuous id-count version, along with the
   section-1 and section-2 settle guards. A blind review found all of it; nothing
   in the rebuild announced it.
   ⇒ **That is the cost of rebuild-over-replay, paid rather than theorised: a
   take keeps what the other side HAS and loses what only YOU had, silently.**
   It is the same shape I had warned Renet about that morning, arriving back at
   me from the other direction. Restored, and the README now says that finding
   the vacuous form again is a REGRESSION rather than a starting point.
   ⭐ **Widening an assertion feels like strengthening it and is worthless if
   the assertion cannot fail.** It also put the false claim in the README, where
   other agents read what is already guarded.
29. **`own === imp` passes when BOTH are hidden.** Now also compared against
   `OWN_ROLE`, the page's own source of truth.
   ⚠️ **AND THE COMMENT I WROTE FOR IT OVERCLAIMED, WHICH A LATER ROUND CAUGHT.**
   I said it "reds on" a payload that serves no `own`. It does not: that state
   gives served=false with both hidden, all three move together, and it passes
   -- correctly, because that state is supported. What it actually catches is a
   DISAGREEMENT between payload and paint. **Narrower than I claimed, and real.**

30. 🛑 **A GUARD I ADDED TO FAIL LOUDLY MADE THE CHECK FAIL GREEN.** In
   `render-found-undo` the catch set `process.exitCode = 1`, and the explicit
   `process.exit()` nine lines later OVERRIDES it. Measured, both arms:
   `exitCode=1 then exit(0)` -> **0**; `exitCode=1, natural end` -> **1**. The
   guard throws before any check runs, so the tally is empty and the file exits
   0 and the runner logs **PASS**.
   ⚠️ **THE GATE CANNOT CATCH THIS, BY CONSTRUCTION: it reads exit codes, and
   the defect IS the exit code.** Now pushed as a finding into the tally the
   exit is derived from.
31. **A WAIT ADDED TO STOP A PREMATURE READ RAN AFTER THE READ.** The eyebrow
   `waitForFunction` sat below the `look()` that captures the value it was
   meant to settle, so the comparison still used the pre-wait sample and the
   fix was inert while its comment said it was closed. `#fr-eyebrow` ships
   EMPTY, so the false red it was written to prevent was fully live.

32. 🛑 **THE FLOOR I ADDED TO FIX A VACUOUS ASSERTION WAS A TAUTOLOGY.**
   `labels.length > 0 || barHidden` -- and `labels` is built by filtering the
   same two buttons on the same hidden flag, so an empty `labels` IMPLIES
   `barHidden`. **True in all four states, checked exhaustively.** It could
   only ever have produced a false red, from a repaint racing between two
   `page.evaluate` calls. Fixed by pinning the payload so every step really
   does offer an action, then requiring one.
33. **MY ANTI-BACK REGEX COULD NOT MATCH THE LABEL THE REAL BUTTON SHIPPED.**
   `/^back$|go back|previous/i` against `← Back`, which is what `#fr-back`
   said at cb28d7c2. Measured: **false**. `\bback\b` matches it, and matches
   none of the 13 labels `frActions` actually builds.
   ⇒ ⭐ **I replaced an unfalsifiable assertion with a falsifiable one that
   still could not catch the thing it named.** Checking that an assertion CAN
   fail is not the same as checking it fails on the ACTUAL case.

34. 🛑 **AN ASSERTION OF MINE PASSED ONLY BECAUSE OF A PRODUCT BUG, AND WOULD
   HAVE OPPOSED THE FIX.** I asserted no first-run step offers a Skip.
   `index.html` builds `{ label: 'Skip connecting a model' }` under Josh's
   ruling of 2026-08-26, and `\bskip\b` matches it. It renders today only
   because `frActions` drops that alt (**#1835**), so the moment somebody fixes
   the defect my guard reds while asserting the opposite of the ruling.
   ⇒ ⭐ **A CHECK THAT PASSES BECAUSE OF A BUG WILL FIGHT THE FIX**, and it
   reads as coverage right up until somebody does the right thing. Rewritten to
   what the pack actually rules out: nothing may offer to skip SETUP ITSELF.
   Controlled both ways: the ruled-in label passes, "Skip setup" reds.
35. **PINNING A ROUTE CHANGED WHAT A NEIGHBOURING COMMENT MEANT.** Pinning
   `path: 'create'` in section 11 moved that walk from the adopt arm to the
   create arm, which falsified a comment two lines away that described the
   adopt arm, and left a live `/api/found-agents` able to time out the settle
   wait and false-red the new floor. **A fixture pin is a change to every claim
   that depends on the fixture.**

36. **THE README KEPT THE RETIRED RULE AFTER THE CODE DROPPED IT.** I rewrote
   the Skip assertion and updated the paragraph's parenthetical, and left the
   load-bearing sentence saying no step offers a Skip. ⇒ **Correcting the code
   and the footnote while the headline still states the old rule is how a
   retired claim survives**, in the file other agents read to learn what is
   guarded.
37. **THE `FAIL ` PREFIX REACHED THREE FILES OF FIVE.** The runner quotes a
   failure reason with `grep -E '^\s*(FAIL|✖)|Error|Timeout|...'`, so a THREW
   line without it reports as "(no FAIL or error line in its output)". I added
   the prefix where I was already editing and not at the two sites where the
   catastrophic case actually lands. **Verified now with both arms: the new
   lines are quoted, the old form is not.**

38. **A STUB THAT LOOKED RIGHT AND SATISFIED NOTHING.** My `/api/machine` stub
   sent `appLocation.detail: ''` and `checks: []`. `frPaintReturn` THROWS on a
   falsy detail and `frPaintMachine` renders "could not check" on an empty
   array, so the section settled through the ERROR arms and walked screens a
   user never sees. ⇒ ⭐ **A fixture has to satisfy the page's own validation,
   not merely have the right SHAPE.** A shape-only stub is a fixture that lies.
39. **A FALSE SIBLING CLAIM WAS COVERING A REAL DEFECT IN THAT SIBLING.** I
   wrote that `render-first-run` short-circuits on a failed settle "for the same
   reason". It did not -- and because it did not, it went on to write
   `firstrun-7-create.png` FROM THE HALF-PAINTED SCREEN: an artefact whose name
   is a false claim about its contents, which is the defect the ending rows were
   renamed to remove, arriving by timing instead of by numbering.
   ⇒ ⭐ **The wrong claim about a sibling was the only thing standing where a
   real finding should have been.** Both fixed: the claim is gone and the
   sibling now skips its identity arm and its screenshot.

40. **I NEARLY SHIPPED THE SAME CLASS A THIRD TIME, AND CAUGHT IT MYSELF.**
   Making the LAST-step block skip its assertions on a failed settle, I wrote
   `return;` -- **inside the `try`, with the summary and `process.exit` after
   the `finally`.** That is the shape that has bitten this file twice already.
   Measured before committing: guard inside the try, summary after the finally,
   so the return would have skipped both. Replaced with a guarded block.
   ⇒ ⭐ **The fix for a control-flow defect is where the next control-flow
   defect goes.**

41. 🛑 **I PINNED AWAY THE ONLY STATE THE FLOOR COULD FAIL ON.** The action-bar
   floor was reddening for a harness reason, so I pinned a connected
   subscription. **With that pin, every step passes a primary, so the floor can
   no longer return the dangerous answer** -- the one product state that empties
   the bar is the unconnected fall-through, and the pin excludes it.
   ⇒ ⭐ **PINNING A FIXTURE TO STOP A FLAKE CAN PIN AWAY THE FAILURE.** The two
   are the same lever.
   ✅ Not un-pinned: the state it excludes is a live product defect (#1835), so
   asserting the correct behaviour there would red the gate on a known bug. The
   comment now SAYS the arm is uncovered and why. **Knowingly uncovered and
   carded beats silently uncovered.**
42. **A JUSTIFYING NUMBER DESCRIBED AN ARM THE BLOCK CANNOT REACH.** I wrote
   that the interim paint is a 52-character paragraph; that is the CREATE arm,
   and this block's own fixture note two paragraphs up says it takes the ADOPT
   arm. **The guard was right and its evidence was about a different screen.**

43. **THE COMMENT WHOSE JOB WAS TO SAY WHAT IS UNCOVERED UNDERSTATED IT SIX
   TIMES OVER.** I wrote that "the ONE product state that empties the bar" is
   the unconnected fall-through. There are **six**: that one, the create-arm
   ending while the search is in flight, and the FOUR connect phases, which all
   sit on the very step the floor measures. **This branch had already counted
   five of them, on card #1835.**
   ⇒ ⭐ **A statement of a blind spot is itself a claim and rots like any
   other** -- and it is the one place a reader has no way to check, because they
   are reading it precisely to learn what they cannot see.
44. **A WAIT I ADDED TO REMOVE A RACE CONVERTED IT INTO A HARD DEPENDENCY.**
   Before it, section 1 read the ending screen while the search was in flight
   and was insensitive to the result. After it, the read is GUARANTEED to happen
   after the search lands, so any adoptable folder on the machine repaints and
   reds both assertions for a machine reason.
   ⇒ **Settling a race does not make a check safer if the settled state depends
   on the machine.** Stubbed, and the stub is registered before the walk reaches
   the ending, because a route added once the fetch is in flight intercepts
   nothing and a reload would throw the walk back to step 1.

45. **THE `FAIL ` PREFIX STOPPED ONE SITE SHORT, TWICE.** After adding it to
   five files I added it to a summary map and still missed the four
   `pageerror` pushes -- and the runner's grep is CASE-SENSITIVE, so
   `JS ERROR:` does not match `Error`. **A run whose only failure was a page
   JS exception reported "(no FAIL or error line in its output)".**
   ⇒ ⭐ **A partial fix stops where you were not already looking**, and that is
   the second time on this branch the same prefix reached most sites and not
   all.
46. **I APPLIED A RULE TWICE IN ONE COMMIT AND NOT AT THE THIRD SITE.** Section
   1's settle failure reported and then ran its two ending assertions anyway,
   so one failure emitted three findings, two of them confident and wrong --
   while the same commit's comments at two other sites state the opposite rule
   in so many words.

47. ✅ **THE RULE IS NOW MECHANISED, AND IT FOUND NINE INSTANCES ON ITS FIRST
   RUN.** A reviewer's sharpest point was that nothing enforced the
   reason-grep contract: it had been guarded by a comment twice, in a repo
   whose thesis is that prose does not apply itself.
   `browser-checks-reason-grep.test.js` now reads the pattern OUT OF the runner
   (so the two cannot drift), asserts the shapes checks actually emit are
   quotable, asserts the PRE-FIX shapes are NOT (so the positives mean
   something), and scans the directory for bare pushes. **Nine, in three files,
   four of them mine.**
   ✅ Proven to fire, both arms, with the backup kept OUTSIDE the worktree:
   remove one literal prefix -> RED; break the structural map -> RED; control
   -> GREEN; restores verified identical.
   ⭐ And the fix moved from per-site to STRUCTURAL: the prefix is applied once
   where every finding passes through, so a new push site cannot miss it.
48. 🛑 **I RAN `git checkout -- <file>` ON A FILE WITH UNCOMMITTED WORK AND
   DESTROYED TWO OF MY OWN EDITS.** To undo a double-prefix I reached for the
   whole-file revert; it took the round's other changes with it.
   ⚠️ **My own handoff carries this exact warning**, from the first time it
   happened tonight. Knowing the trap by name did not stop me walking into it,
   because the reach for it is reflexive at the moment something looks wrong.
   ✅ Restored by redoing them, and every perturbation since has used a `cp`
   backup kept outside the worktree.

49. 🛑🛑 **THE TEST I WROTE TO MECHANISE THE RULE HAD THE SAME BLIND SPOT AS
   THE FIX IT WAS GUARDING, AND PASSED GREEN OVER MY OWN BROKEN FIX.**
   I prefixed the pushed STRINGS in two files. Those files print
   `console.error('  - ' + p)`, so the LINE came out `  - FAIL  ...` and the
   runner's grep is ANCHORED (`^\s*(FAIL|✖)`) -- unmatchable. **The strings
   were right and every line was still unquotable.** My test asserted the
   pushed string, so it agreed with me.
   ⇒ ⭐⭐ **A GUARD WRITTEN FROM THE SAME MENTAL MODEL AS THE FIX INHERITS ITS
   BLIND SPOT AND CERTIFIES IT.** That is worse than no guard, because it
   converts an open question into a settled one.
   ✅ Rewritten to model **the line that is printed**, not the string that is
   pushed. It then found the defect at **six more files**, plus
   `render-boot-no-flash` printing `✗` (U+2717) where the runner matches
   `✖` (U+2716) -- a difference invisible on screen.
   ✅ Proven to fire on three arms, backups kept outside the worktree: the
   decoration defect, a broken summary map, and a second grep added to the
   runner. Control green, restores verified identical.
50. **AND ITS FIRST RUN MANUFACTURED WORK, WHICH IS THE OTHER FAILURE
   DIRECTION.** The scan flagged `console.log('  ' + JSON.stringify(row))` --
   an ordinary data dump -- as an unquotable failure. **A sweep produces
   candidates, not findings**, so the matcher now keys on the line mentioning a
   findings collection. Classifying was the step that turned 8 candidates into
   6 real ones and 2 to leave alone.

51. **THE REWRITTEN GUARD WAS STILL BLIND, ON TWO AXES AT ONCE, TO A WIRED
   CHECK.** `render-thread` writes its findings with `process.stdout.write` and
   a `✘` (U+2718) where the runner matches `✖` (U+2716), and its collection is
   named `failures`, which my name list did not include. **Two independent
   blind spots, either of which alone would have hidden it.**
   ⇒ ⭐ **An enumeration misses what is not in it, and adding the missing entry
   does not make it stop being an enumeration.** Both axes are closed and the
   header now says so instead of implying coverage.
52. 🛑 **AND I HAD WRITTEN THAT THE FLOOR CONTAINED THAT GAP. IT CANNOT.** The
   floor asserts the MATCHER found enough sites, so a shape the matcher does
   not recognise leaves the count unchanged and the scan silently clean.
   ⇒ **A limitation note that overstates its own mitigation is worse than no
   note**, because it is read by someone deciding not to look further. Same
   class as 43: a statement about a blind spot is a claim and rots like any
   other.
53. ✅ **THE TRANSLATION RISK IS NOW MEASURED, NOT ASSUMED.** Everything in the
   guard converts the runner's POSIX ERE into a JS RegExp, and the whole test's
   authority rested on that being faithful. A new arm hands the extracted
   pattern to the SAME `grep -E` the runner uses and asserts they agree.
   ✅ Proven to fire: swapping `\s` for `[[:space:]]` in the runner makes them
   disagree and the arm names the line. Control green, runner restored
   identical.

54. 🛑🛑 **THE GUARD'S CLASSIFIER WAS AN ENUMERATION OF GLYPHS AND OMITTED THE
   ONE IT HAD JUST BEEN EXTENDED TO CATCH.** I added a `process.stdout.write`
   axis specifically to see `render-thread`, whose emit was `  ✘ ` (U+2718).
   **My decoration classifier listed `[\s\-*•✗✖>]` and not `✘`, so it
   DISCARDED that site and the scan stayed green over the defect** -- while the
   commit message, the inline comment and plan item 51 all said "both axes are
   closed".
   ⇒ ⭐⭐⭐ **AN ENUMERATION GUARDING AGAINST AN ENUMERATION REPRODUCES THE
   FAILURE IT NAMES.** Now defined structurally: a per-finding decoration is a
   prefix with no word characters except the literal FAIL, which admits any
   marker anyone invents.
   ✅ Proven by replaying `main`'s emit: the old classifier returned GREEN, the
   new one names the file. Control green, restore verified identical.
55. **AND THE EXEMPTION ITSELF HIDES THINGS, WHICH IS NOW SAID RATHER THAN
   IMPLIED.** A prefix carrying WORDS is treated as ordinary logging, so
   `render-fields`' instrument self-check (whose failure line starts with a
   sentence) is dropped. The header names that, and names the two WIRED checks
   the scan still cannot see (`render-talk`, 88 bare findings, and
   `render-projects`), carded as **#1836**.
   ⇒ **A green run means "every shape this scan recognises is quotable", not
   "every check is."**

56. **THE CLASSIFIER READ THE SOURCE TEXT, NOT THE PRINTED PREFIX** -- one
   layer below the file's own thesis. A source `'\n  - '` is six characters, so
   the `n` reads as a word and the site was silently dropped, while the line
   actually printed is `  - finding` and is unquotable. Now decoded, then
   truncated at the last newline, because that is the line the runner greps.
57. **AND THE STRUCTURAL REWRITE REOPENED THE MANUFACTURE-WORK DIRECTION.**
   `^[^\w]*(FAIL)?[^\w]*$` admits `''` and `'  '`, so an ordinary
   `console.log('  ' + JSON.stringify(row))` would have RED the test -- the
   exact defect item 50 closed, reintroduced by the change that closed the
   enumeration.
58. **I CLAIMED A PERTURBATION PROVED SOMETHING IT DID NOT, AND CAUGHT IT BY
   RE-RUNNING IT COUNT-NEUTRALLY.** My first perturbation of the escape fix
   ADDED an emit site, so the test red on the exact-count assertion rather than
   on quotability. Re-run without changing the count: a WORD-FREE escaped
   prefix is caught; the same shape carrying WORDS is not, because the
   word-prefix exemption drops it.
   ⇒ ⭐ **A perturbation that changes two things at once proves neither.** The
   header now states the exemption's cost with the measurement, and names the
   three fixed-but-unguarded lines rather than implying they are covered.

⭐⭐ **THE PATTERN ACROSS 2, 3, AND 9 THROUGH 58, AND IT IS THE MOST USEFUL
THING ON THIS BRANCH: EVERY ONE IS A CORRECTION THAT INTRODUCED A NEW FALSE
CLAIM, OR A NEW INSTANCE OF THE DEFECT IT WAS FIXING.**

**A correction is the one edit nobody re-reviews**, because it arrives wearing
the authority of having just found something. Six blind rounds were needed on a
five-file diff, and after the first round almost every finding was against code
written to fix the previous finding.

⇒ **Do not stop reviewing when the fix lands. Review the fix.**

## 🛑 Why this loop read as non-converging, measured at iteration 8

```
iter   BLOCKER   WARNING   NIT
  1       1         2       3
  2       0         7       5
  3       0         6       5
  4       0         7       3
  5       0         4       4
  6       0         3       5
  7       0         5       5
  8       0         6       6
```

**BLOCKERs: one, in iteration 1, and none in the seven since. WARNINGs: flat.**

⭐ **The count says "not converging" and the count is the wrong instrument.**
After iteration 1 the reviewers were overwhelmingly finding defects in the code
and prose written to fix the PREVIOUS round: in iteration 8, four of six
warnings were about text added in iteration 7.

⇒ **THE LOOP WAS NOT FAILING TO CONVERGE. IT WAS CONVERGING ON A TARGET THAT
KEPT MOVING**, because each round added explanatory comments and each next
round correctly found defects in them.

✅ **The tell is the severity split, not the count.** Flat warnings with zero
blockers means polishing, not fixing. **From outside, and from the commit
messages, that is indistinguishable from a genuinely rich seam.**

## A product defect found on the way, and carded rather than fixed

**`frActions` discards its `alt` button when there is no primary, so FIVE call
sites lose a button they pass** -- including **four `Cancel` buttons in the
connect flow**, on the big-download, installing, browser-sign-in and code-entry
screens. A person waiting on a long download has no visible way to stop it, and
`frConnCancel` is unreachable from all four.

Carded as **#1835**. Not fixed here, on the same reasoning as #1800: a product
fix buried in a check-update PR is how it ships unnoticed. Its weakest premise
is named on the card (read from source, not driven in a browser).

⭐ **Found because a reviewer asked when the page shows NO buttons**, in order
to decide whether a new assertion could be vacuous. **The check work found a
product defect that no check covers.**

## Left undone on purpose, with the reason

**Nine `waitForFunction` calls in three OTHER checks pass their options in the
`arg` slot, so their timeouts are ignored and the 30s default applies.**
Measured with a paren-matching parser and a positive control (51 correct-form
sites, so the parser sees both shapes). Carded as **#1826**.

**Not fixed here, deliberately: the fix makes those waits SHORTER**, from 30s
to the written value, which is exactly the change that turns a slow-but-passing
check into a flaky one. That is a behaviour change in three files this branch
does not otherwise touch, under a release. The two sites of the same defect in
`render-first-run.js` ARE fixed, because that file is already under review here
and every gate run above covers it.

## The reason-grep guard: what it cost to get right

**`browser-checks-reason-grep.test.js` is referenced from its own header to this
section.** The file states what it covers and what it does not; the record of
how it was wrong lives here, so that editing the file does not mean editing a
record.

### The defect class, and why one guard is warranted for it

`run_one` in `tools/browser-checks.sh` prints the reason beside a red by
grepping the check's captured output. A failure LINE that does not match that
grep reports as "(no FAIL or error line in its output; read the full log)".
**The gate reds without naming what went wrong**, which is the worst moment for
it to be silent.

🛑 **The class recurred THREE times on this one branch, each time as a PARTIAL
fix.** That is not an argument that it might recur; it is the class
demonstrating its own recurrence rate.

1. The `FAIL` prefix reached five files and **missed the pageerror pushes**.
2. The runner's alternation is **CASE-SENSITIVE**, so `JS ERROR:` never matched
   the `Error` branch.
3. The prefix was added to the **PUSH** while the file printed `'  - ' + p`, so
   the line came out `  - FAIL  ...` and the ANCHORED `^\s*(FAIL|✖)` branch
   could not match it. **The strings were right and every line was still
   unquotable.**

⇒ **That third one is why the test is keyed on the PRINTED LINE rather than the
pushed string.**

### Four ways the guard itself was wrong, found by successive review rounds

**These are recorded because each is a general trap, not because the file still
contains them. All four are fixed.**

1. **It checked the pushed string and passed green over defect 3 above** -- the
   same blind spot as the fix it was guarding. ⭐ **A guard written from the
   same mental model as the fix inherits its blind spot and certifies it**,
   which is worse than no guard, because it turns an open question into a
   settled one.
2. **Its classifier was an enumeration of glyphs**, `[\s\-*•✗✖>]`, which omitted
   `✘` (U+2718) -- the exact glyph the scan's `process.stdout.write` axis had
   just been added to catch. It DISCARDED that site and stayed green over the
   defect it had been extended for. ⭐ **An enumeration guarding against an
   enumeration reproduces the failure it names.** Replaced with a structural
   rule: a per-finding decoration is "no word characters except the literal
   FAIL", which admits any marker anyone invents.
3. **The classifier read SOURCE TEXT, not the printed prefix.** A source
   `'\n  - '` is six characters, so a raw read sees the word character `n`,
   discards the site, and stays green over a line that actually prints
   `  - finding`. Fixed by decoding the escapes and keeping what follows the
   last newline.
4. **The site floor was a floor, and its slack exceeded what it guarded.** At
   `>= 17`, dropping the stdout axis left 18 and dropping the map axis left
   exactly 17, so **either axis could be lost silently**. Replaced with an exact
   count. ⭐ **A floor whose slack is bigger than the thing it guards is
   decoration.**

⚠️ **And one direction was reopened by the fix to another.** The structural rule
in (2) admitted `''` and `'  '`, so an ordinary
`console.log('  ' + JSON.stringify(row))` on a line mentioning `problems` would
have RED the test -- the manufacture-work direction. A non-whitespace guard
closes it.

### The decision to keep it, taken deliberately 2026-09-02

**The challenge loop reached 28 rounds without converging, and rounds 25 to 28
found their defects almost entirely in this file.** The question put explicitly
was: keep it or drop it. It is not required by the card.

✅ **KEPT, with its correction archaeology moved here.**

- **Why kept:** the class recurred three times as partial fixes, the failure
  mode is a gate that reds without naming the reason, and the scan found a WIRED
  check no other instrument found.
- **Why not kept as it stood, measured rather than felt:** **125 of its 240
  lines were comments, 52 percent**, and most of that was narrative about which
  PREVIOUS VERSION OF THE FILE was wrong. Each round's reviewer correctly found
  defects in the last round's prose. ⇒ **The seam was the archaeology, not the
  code.** Immediately after the move: 227 lines, 101 of them code, and the code
  is
  byte-identical (verified by stripping comments from both versions and diffing,
  with two perturbation controls that both went red, one of them aimed inside
  the regex character class an earlier broken stripper had mangled).
  ⚠️ **THAT 227/101 IS A SNAPSHOT OF THE MOVE, NOT OF THE FILE.** Iterations 29
  and 29b added SHAPE 4 and the marker-carrying arm; at iteration 33 it is
  **311 lines, 111 of them code.** Left as a dated pair rather than
  updated in place, because the 227/101 is what makes the code-identity claim
  beside it meaningful. ⭐ **Caught by a reviewer quoting this plan's own rule
  back at it: a denominator is a measurement too.** A past-tense number still
  needs to say WHEN, or a reader checks the file and finds a different one.
- **What deliberately stayed in the file:** the BOUNDS. What the scan does not
  cover, the enumeration warning, and the worded-prefix exemption with its
  measured cost. A reader who does not know the limits will over-trust the
  guard.
- **Weakest premise, named rather than buried:** I asserted that round 28's four
  WARNINGs were against prose rather than code. **They are not written down
  anywhere, so that is inferred from the comment ratio, not measured.**
- **What would change my mind:** the next round returning findings against the
  CODE of this file. That makes the premise wrong and makes dropping the test
  the right call instead.

### 🛑 THE PREMISE WAS TESTED AT ROUND 29 AND IT WAS WRONG

**Round 29 returned two WARNINGs and BOTH were against CODE.** I had predicted
prose. So "the archaeology is the seam" is **not** why the loop was not
converging, and I am recording that rather than quietly keeping the conclusion
it supported.

⭐ **But the conclusion it supported survives on better evidence than the
reasoning that produced it.** The finding was that the guard was blind to the
three THREW reporters THIS BRANCH ADDS, on two independent axes. I did not
argue it, I perturbed it: **removing the `FAIL` from render-found-count.js's
reporter left the guard GREEN at exit 0.** A guard that reads as coverage and
is not is worse than no guard, so that was a live defect in the thing I had
just decided to keep.

⇒ **Fixing it made the guard immediately earn its place: it caught
`render-fields`' instrument self-check printing an unquotable line** -- a site
this very file claimed "had been fixed", which was false, and which no run
would ever have named. Baseline 0, four of four sites red under perturbation.

⚠️ **What I would tell the next person, because it is the transferable part:**
the archaeology move was still right, but for a smaller reason than I gave it.
It removed prose-defect surface. **It did not remove the seam, and I had no
evidence it would.** The honest version of my round-29 note should have been
"I am removing the archaeology because corrections do not belong in a file
still being edited", full stop, with no claim about convergence attached.
**I attached a prediction to a tidy-up and the prediction failed.**

## 🛑 ROW 32 WAS FALSE THE MOMENT IT WAS WRITTEN, BY ITS OWN TEST

**Row 32 originally claimed `08fd5c68` was "the only row that measures the
merged code".** Run this section's own survival test against HEAD:

```
git diff --name-only 08fd5c68..HEAD -- 'docs/browser-checks/*.js' tools/browser-checks.sh
  -> at least one file. Row 32 claimed ZERO. Any non-empty result falsifies it.
```

⚠️ **THE OUTPUT IS DELIBERATELY NOT PASTED HERE, AND THAT IS A CORRECTION.** It
used to read `-> click-first-run.js  # 1, not 0`, which was true when written and
became wrong at iteration 34 when `render-first-run.js` joined it. **A stale
measurement, inside the section whose entire subject is stale measurements,
for the fourth time on this branch.** ⇒ **The invariant is what belongs in a
document; the count belongs in the terminal.** Row 32 claimed zero, so ANY
non-empty result refutes it, and that sentence cannot go stale as the list grows.

⭐ **THE COMMIT THAT ADDED ROW 32 IS THE COMMIT THAT INVALIDATED IT.** `23bbb827`
wrote the row AND rewrote `click-first-run.js` section 2 into an
`if (!firstRunCompleted) … else` branch. **One commit, both halves.** Control:
the same test at `08fd5c68..08fd5c68` returns 0, so the instrument is sound.

⇒ **This is the round-30 BLOCKER reintroduced by the fix for the round-30
BLOCKER**, which is the same shape as the section-1/section-2 defect three
paragraphs of this plan already describe: **a fix can move a defect up a level
rather than remove it.** It did it to me twice in one iteration, in code and
then in the evidence about the code.

📌 **DELIBERATELY NOT RE-RUNNING THE GATE TO CLEAR THIS TODAY, AND THE REASON IS
NOT COST.** The ordering decision of 2026-09-02 07:28 puts Renet's identity fix
for #1801 onto `main` FIRST. His files are in this branch's executed set, so a
run now would be invalidated by his landing within the hour, and a second row
claiming to measure the merged code would then be false in exactly the way this
section exists to record. **One run, after the rebase, is the honest number.**
⇒ **Until that row exists, this branch has NO run measuring its merged state,
and that is stated rather than papered over.**

🛑 **AND THE POST-REBASE RUN IS MANDATORY, NOT A FORMALITY. HERE IS EXACTLY WHAT
HAS NEVER BEEN EXECUTED.** Since `08fd5c68`, the only BEHAVIOURAL change in
`click-first-run.js` is section 2's `if (!firstRunCompleted) … else` skip branch
(plus, at iteration 35, the guarded flag read and one reordered assertion).
Everything else in that range is comment.

⇒ **So the sole unexercised control flow on this branch is a SKIP BRANCH in the
file that twelve other sections depend on**, and `node --check` proves only that
it parses. **A syntax check is not a smoke test.** If that branch is wrong, the
failure mode is section 2 silently not running rather than a loud red, which is
the quietest possible way to lose coverage.

📌 The skip arm is also, by construction, the arm a green run does NOT exercise:
it fires only when an ending never settles. **A passing gate run will take the
`else` and tell us nothing about the branch we just added.** That is not a
reason to skip the run, it is a reason to say what the run does and does not
establish.

## 🛑 A PUBLISHED PREDICTION THAT FAILED, AND WHAT IT COST

**Round 30's BLOCKER was that no recorded run measured the merged code.** While
fixing it I published a checkable prediction, deliberately, so the claim could
not quietly become a re-assertion: **since `render-model-change.js` was newly
present and wired, the run should report MORE than the 56 every prior row
cites, and if it still said 56 the check was not being run and that was a
separate finding.**

**IT SAID 56.** And the consequence I attached was ALSO wrong: the check DID
run, group header at line 1555 of the run log. **There is no separate finding.**

⭐ **Both halves failed for one reason: the premise under them.** The check was
never new. It existed at the pre-rebase commit, was already in the runner's
list, and had run in all fourteen green runs -- `git diff --name-status` says
**`M`, not `A`.** It grew from 289 lines to 398.

⇒ **`ran=56` was exactly right.** No check was added, so no count changed. The
number I predicted would move had no reason to move.

📌 **THE PART WORTH KEEPING.** The prediction was published fleet-wide and I had
to report it either way, which is the only reason the underlying error surfaced
at all. **A prediction that fails tells you something a re-assertion never
would**, and the cost of publishing one is exactly this: you correct it in
public, quickly, before anyone builds on it. That is the trade and it is worth
taking again.

⚠️ **AND THE GENERAL FORM OF THE MISTAKE, which is not about rebases.** The
diff-the-executed-files test answered correctly: executed content changed. **I
supplied the reason -- "a new check" -- out of my own expectation, and then
predicted from my addition rather than from its answer.** An instrument that
reports THAT something changed does not report WHAT KIND of change it was.

## Rebase resolution map for Renet's #1801, from Renet, 2026-09-02 07:54

**Recorded here because it arrived in a message and a message is not durable.**
He verified it by running both versions on the same board rather than reasoning
about it: his identity fix passes every step-index assertion, and `origin/main`
`click-first-run` fails four including a THREW when the fixed-count walk lands on
Accessibility and cannot fill `#fr-you-name`.

| file | resolution |
|---|---|
| `click-first-run.js` step-index hunks (re-pin 6 to 7, the added Accessibility walk) | **CONFLICT, resolve to HIS.** Drop mine. |
| `click-first-run.js` roles fix (the shape / `OWN_ROLE` assertion, ~445-473) | **KEEP MINE.** Applies clean; it is in the create-panel section he did not touch. |
| `render-found-undo.js`, `render-found-count.js`, `render-first-run.js` | 🛑 **A MERGE, NOT A TAKE.** Take HIS step-index and `#fr-fleet` discovery; **KEEP MY try/catch THREW reporters.** |
| `render-role-order.js` | **KEEP MINE.** Not in his PR at all. |

🛑 **THE ROW ABOVE ORIGINALLY READ "full supersessions, resolve to HIS", WHICH
WOULD HAVE SILENTLY DELETED ITERATION 29'S WORK.** Measured against his PR head
`5de8a241` rather than reasoned:

```
file                      main  renet  MINE
render-found-count.js     0     0      1
render-found-undo.js      0     0      1
render-first-run.js       0     0      2
render-role-order.js      0     0      2
click-first-run.js        1     1      2      <- CONTROL, all three agree
```

⇒ **His versions carry ZERO THREW reporters, the same as `main`, because they are
main-based.** Applied wholesale, "resolve to his" removes the in-run
throw-to-finding catch from those files entirely, so a throw exits with no
FAILURES line and the gate reports nothing quotable.

⭐ **AND HIS SENTENCE "I DID NOT TOUCH ANY THREW REPORTER" IS TRUE AND IS A
DIFFERENT CLAIM.** He did not touch them because his branch never had them.
Nothing he did was wrong; **the map described a two-way merge as a one-way
take**, which is a shape worth recognising: "resolve to X" is safe only when the
two sides changed the same thing, and silently lossy when one side ADDED
something the other never had.

✅ He confirmed the correction and is deliberately NOT pulling my THREW reporters
or roles fix into his PR, so my rebase stays a clean two-way merge rather than a
take-versus-take.

📌 **Also measured, in a scratch worktree, my five guards against his branch:
18 of 19 pass.** His new `lib-firstrun-steps.js` satisfies my wired test's
library exemption, because that test keys on `module.exports` STRUCTURALLY
rather than on a list -- the same lesson as everything else here. The one
failure is my own emit-site count reading 20 against 29, which is exactly the
THREW delta above and is **my number to update after the rebase**, not a defect
in his PR.

🛑 **AND ONE CONSEQUENCE NEITHER OF US PRICED WHEN THE ORDER WAS DECIDED.** His
`click-first-run` leaves **exactly one red**: line 286, `.pick2:visible === 3`
against a page with four now that `#pick-import` exists. **That is the #1652
defect my branch fixes**, and it is why he says my roles fix is still needed.

⇒ **So `main` does NOT go green when he lands. It goes from four-plus reds to
one, and stays red until this branch lands too.** The ordering decision is still
right -- one red beats four, and the wait for this loop was unbounded -- but
anyone who reads his merge as "the gate is green on main" will be wrong, and
that is exactly the sentence somebody writes.

## #1835 LANDED ON MAIN, AND THE DISMISSAL-CONDITION PAID FOR ITSELF

**2026-09-02, `67d0d08a`.** `frActions` now renders the alt when primary is
null, so five first-run buttons that never painted now paint. **This branch had
an assertion that passed only because that defect existed**, which is recorded
above as one of the things I got most wrong, and which I had already narrowed.

✅ **VERIFIED AGAINST THE ACTUAL FIXED PAGE, not reasoned.** The two labels the
fix restores, run against the three assertions that read the action bar:

```
"Skip connecting a model"   back assertion: false   skip-setup assertion: false
"Cancel"                    back assertion: false   skip-setup assertion: false
CONTROL "Skip setup"                                skip-setup assertion: TRUE
CONTROL "Back"              back assertion: TRUE
```

⇒ **The assertions survive the fix AND can still fail on the historical labels.**
The narrowing did its job, and the controls are what make that a measurement
rather than a hope.

🛑 **BUT THE RUN EVIDENCE DID NOT SURVIVE IT, AND THIS IS THE FIRST USE OF THE
CORRECTED DISCRIMINATOR ABOVE:**

```
08fd5c68..origin/main, checks only      -> 20
08fd5c68..origin/main, checks + page    -> 21     <- web/index.html
```

⇒ **The gate green on `08fd5c68` was ALREADY invalid before Renet lands**,
because a product fix changed the page underneath it. The old rule would have
counted 20 either way and never told me the page moved.

⭐ **AND THE REUSABLE PART IS NOT THE FIX, IT IS THE BOOKKEEPING.** The comment
dismissing this work carried the CONDITION under which the dismissal would stop
holding ("asserting the correct behaviour would red the gate on a known product
bug"). When #1835 landed, that condition went false and there was something to
grep for. **A finding dismissed without a written condition cannot be reopened by
the event that invalidates it.**

## What would change my mind

If `#import-text` is deliberately not a field, #1800 is a check exemption
rather than a defect. I have not asked whoever built #1652.
