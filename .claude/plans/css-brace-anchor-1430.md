# Unpin CSS assertions from their rule's closing brace (#1430)

Branch `css-brace-anchor-1430`.

## Context

A CSS assertion anchored on its rule's closing brace fails on **any legitimate addition to that
rule**. #1310 added `max-width: 100%` to a `.pjname` rule, the property that makes the title
truncation possible at all, and `web.project-rows.test.js` had pinned that rule as ENDING after
`justify-content`. **Main went red at step 3, so no cut could run.** #1427 fixed that one line.
This card is the rest of the class, and it was filed rather than fixed because **the judgement is
per assertion, not a regex**.

## What changed

33 assertions across 8 test files, on the project-row and consolidated-layout surface. Each had
its trailing ` \}` dropped so the assertion ends after the declarations it promises, which is the
form #1427 established. An explicit enumerated list, not a sweep.

| verdict | n | why |
|---|---|---|
| **LOOSENED** | 29 | placement and sizing on rules under active design; these gain declarations routinely |
| KEEP, negative assertion | 1 | loosening a `doesNotMatch` makes it match MORE, so it starts failing on rules that merely resemble the forbidden one |
| KEEP, single complete declaration | 42 | `display: none`, `display: contents`, resets |
| KEEP, media-block structure | 3 | the block shape is the promise |
| SUPERSEDED on main | 5 | `a6a7d717` replaced one with an id sweep plus a population floor; **#1476 (`625ad5bf`) replaced three more with cascade-resolving `effective()` checks**. My loosening of all four is obsolete |
| DEFERRED, other surfaces | 13 | 3 by name (`web.room-761:50`, `web.layout-picker:304`, `web.project-page:72`), 10 by count |

**Recipe:** an `assert` line carrying an escaped `\{ ... \}` whose content is a CSS declaration
list, classified as brace-anchored unless the tail is an open wildcard.

⚠️ **It reproduces the in-scope bucket exactly (42 across the 8 touched files = 29 loosened + 12 keeps + 1 negative) and does NOT reproduce the tree-wide 93** -- an independent run of the same
recipe against current `main` returns 100. The gap is entirely in the deferred tail this branch
does not touch, and part of it is the superseded row being counted pre-rebase. **The in-scope
numbers are the ones this change rests on; treat the tree-wide 93 as approximate.**

⚠️ **Only the keeps in the 8 touched files were measured**: 13 brace-anchored lines, being 12
`assert.match` keeps plus the one `doesNotMatch`. The rest of the 46 are tree-wide and were not
measured.

## Proof

Card criterion 2 is that a loosened assertion still goes red on real breakage. **A green run cannot
show that**, so each ran on four arms, in memory against `web/index.html`:

```
A  corrupt the promised property        -> RED
B  append a legitimate declaration      -> GREEN
C  the OLD form on that same addition   -> RED     (so the change is load-bearing)
D  the OLD form on the untouched page   -> matched (so it really was pinned)
```

**All but one pass all four.** Arms C and D exist so the result cannot be decoration: a check that
only ever returns the safe answer has never been tested.

Suite: the 8 files run **40 tests, 40 pass, 0 fail**. Counts read, not colour.

## The one that could not be proven, and the finding under it

`web.consolidated-project-name-overflow.test.js` failed arms A and C, and **the anchor is not the
reason**: that rule is byte-identical **twice** in `web/index.html`. Find it by selector, never by
line. Control: `#pj-composerhint { display: none; }` counts 1, so a 2 means something.

Either copy satisfies a plain match, so it was blind pinned and blind loosened. **The occurrence
count is now the assertion**, which restores a real guard and pins the duplicate so **#1459** cannot
be closed by deleting a copy unnoticed. Proven: one copy regressed → RED where a plain match stays
GREEN; one copy removed → RED.

⚠️ **This couples the test to the defect.** When #1459 lands the 2 becomes a 1, and that is written
at the assertion as the intended edit. The alternative was an assertion that cannot fail.

## 🛑 What the four-arm proof does NOT establish

All four arms operate on the rule **TEXT**. **None of them asks whether that rule GOVERNS.** An
assertion can pass all four and still be blind to the behaviour it names.

**Measured, and it is live at two sites this branch touches** (pre-existing on main, filed as
**#1476**): `web/index.html` declares one selector twice and the later rule wins, while the
assertion pins the earlier one. Deleting the *winning* rule changes behaviour and the assertion
**stays green**; deleting the *dead* rule changes nothing and it **goes red**. Inverted.

⇒ **Arm A proves the assertion tracks the text. It does not prove the assertion guards the
behaviour.** Nothing in this change establishes the second, and the four-arm framing should not be
read as claiming it.

## Five residuals, stated rather than discovered later

1. **Same-rule override.** An open tail cannot see a declaration appended later in the same rule
   that overrides an earlier one. Measured against the old form as a contrast. It bites hardest on
   a promise of ABSENCE, and each affected file names its own at the site.
2. **Append, not insert.** Dropping the brace tolerates a declaration APPENDED after the promised
   list; one INSERTED between promised declarations still reds. 🛑 **#1310 happened to append. Had
   that property been grouped beside `order`, this change would not have prevented it.**
3. 🛑 **The keeps carry the original defect by construction.** A kept pin still goes RED on a
   legitimate append. Measured: appending `margin: 0;` reds 12 of 12 keeps. The justification is a
   **snapshot of today's stylesheet**, not a property of the rule. If a kept rule gains a
   declaration, loosen it rather than treating the pin as settled.
4. **Same-SELECTOR, later-RULE override.** A whole second rule for the same selector, later in the
   sheet, wins and the assertion never sees it. **Distinct from residual 1**, which is a second
   declaration inside the *same* rule. Dropping the brace neither caused nor cured it: the old
   pinned form was equally blind.
   ✅ **Two instances FIXED while this branch was in review**, not by me: #1476 / PR #1485
   (`625ad5bf`) replaced them with assertions that resolve the cascade and shipped a guard.
   **Three of my loosenings became obsolete as a result**, which is why the count moved 33 to 30.
   Asserting the rule that GOVERNS is strictly better than loosening a pin on one that does not.

   ✅ **A FOURTH AND FIFTH were found by PigeonPete after I reported the same-value blind spot**:
   fixing his guard to flag a later re-declaration REGARDLESS OF VALUE surfaced `#pj-list.asgrid`
   declared twice with **byte-identical** declarations, so his old `wins !== value` test had sat
   silent on exactly its own defect class. Landed as PR #1549.

   🛑 **A THIRD instance was found in round 16, and it was mine.** `.pj-row .pjcount` is declared
   three times in one scope and the last re-declares `margin-left`, so the pinned rule never
   governed. Measured: deleting the pinned rule went RED with no behaviour change; breaking the
   winning rule stayed GREEN. **Round 10 had already looked straight at the shadowing rule and
   cited it as evidence the selector attracts appends, without noticing it also shadows.** Now
   asserted with `effective()`, and proven the other way round.
   ⚠️ **#1476's guard could not catch it**: it flags only when the winning declaration has a
   DIFFERENT value, and both of these are `0`.

   ⚠️ **AND LOOSENING COSTS THAT GUARD ITS VIEW OF THESE FILES.** It matches a rule WITH its closing
   brace, so dropping the brace removes the match. Measured: on `main` it sees 3 such assertions in
   the 8 touched files; on this branch, 0. Nothing fails today. The fix is a brace-optional matcher,
   which belongs with #1469 rather than patched in quietly here.
5. **Not mechanically enforced (#1469).** A guard was built three times and shipped zero times.
   Two versions had measured false negatives; the second was blind to a re-pin written with an
   **unescaped** closing brace, which re-creates #1310 exactly. **A guard green on the very
   spelling that caused the defect is not partial coverage, it is aimed away from the target**, and
   a green nobody can trust stops the next person looking. #1469 carries the eight planted arms.

## The finding worth more than the card

**Every LOOSENED assertion got a four-arm proof. Every KEPT one got an argument.** Fourteen review
rounds found no wrong proof and one wrong argument: `.pj-row .pjcount` was kept as *"nothing would
ever be appended"* while the page already carried that selector with a second declaration.
Appending to the guarded site turned it RED.

🔑 **It was not merely unmeasured, it was CHECKABLE AND UNCHECKED.** One grep would have disproved
it before it was written down.

⇒ **State a keep's argument as a query and run it.** "Nothing appends to this selector" IS a grep.
Run on the whole class afterwards, not just the instance you were caught on: 12 keeps, 0 carry the
defect, positive control flagging and negative control clean.

## A sibling brittleness, measured and deliberately not fixed

`web.consolidated-match-mock.test.js` reads a hard-coded `PAGE.slice(anchor, anchor + 400)`.
Currently **154 characters of headroom** (recipe: last asserted match's end offset subtracted from
400 -- the figure moves with the diff, so re-measure rather than trust it). Loosening `.pjcount`
took its page-wide match count from 2 to 3, so that window is now load-bearing; it is noted at the
code.

**Not fixed here on purpose**: it is pre-existing, it is not a brace anchor, and changing an
assertion's targeting needs its own proof. Fixing it quietly inside this card would be the
mid-loop artifact-adding that cost this branch three rounds.

## Scope, and what stays open

**#1430 stays OPEN after this merges** -- the commit uses a bare `(#1430)` with no closing keyword.
This covers 8 files; the card names the class.

## Finished when

- The 8 files pass. ✅ 40/40
- Every loosened assertion proven on four arms, or excepted with a reason. ✅ 32 clean, 1 excepted and count-guarded
- Assertions meant to stay exact keep their pin and say why. ✅ 8 policy headers
- `web/index.html` untouched, so no collision with concurrent work on it. ✅
- Mechanical enforcement of the class. ❌ **Not delivered**, filed as #1469 with its arms. Saying so
  plainly is the point: the alternative was a green I could not trust.
