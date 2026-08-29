---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: stepguard-1449
diff_hash: 1b6e349b5c297bcce4fb8e0e0936c480bf70f679d6526fd5e0b325465b53c455
subdir_audit: passed
timestamp: 2026-08-29T16:34:50Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready). Bracketed markers because the
template's own heading is refused by this gate, my #1458.

**Scope narrowed by measurement before any code was written**, and the narrowing is on the
card so nobody redoes it.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] This is a STATIC assertion on `tools/release.sh`, so it can go stale in a way
  a behavioural test cannot.** If the completion line is ever rewritten in a different but
  equally-correct form, this fails on correct code. Accepted deliberately: cuts are running
  today and a test that EXECUTES the release script is the larger risk. The failure messages
  each name what to look at rather than saying "does not match."
- **[WARNING]** Assertion 3 matches `^_STEP=` at line start. A future refactor that
  initialises `_STEP` inside a function would fail this while being correct. Same trade,
  same reason, named rather than buried.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** `Closes #1449`: all three asks are satisfied, two of them by
  `ac65aea3` before I arrived, and the evidence for that is on the card.

### NITs

- **[NIT]** Four assertions in one test rather than four tests. Kept together because they
  guard one property by three mechanisms plus a control, and splitting would invite someone
  to delete "the redundant ones."

### Attacked and CLEARED

- **Perturbed all four independently**: remove the format field, the default, the
  initialiser, or the function. **One failure each, with its own distinct message.** The
  control breaks 14 tests, because other release tests depend on `cut_record_done`.
  Restores sha-verified.
- **The card's own numbers re-measured**, and they had MOVED: 42/25 now against its 39/22,
  with the stepless count unchanged at 17.
- **Suite 2942 pass, 0 fail**, guard present by name.

### The finding that changed what I built

**Two of the three asks were already implemented.** Had I worked from the card's wording I
would have modified `tools/release.sh` on a day with active cuts, to add instrumentation
that is already there.

⚠️ **And I nearly concluded it from the wrong evidence.** A streak of 25 consecutive
stepped failures is equally consistent with "the fix landed" and "that failure mode stopped
occurring." **The commit and the `:-unknown` default are what make it a fix**; the streak
alone would not have.

### What I am NOT claiming

**I have not run a cut.** This reads the script's source and asserts three properties of it.
**Whether a real failing cut writes the field is evidenced by the log, not by this test**,
and that evidence is historical rather than something I produced.
