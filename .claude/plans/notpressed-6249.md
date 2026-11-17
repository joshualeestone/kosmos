# #6249: a line not pressed beside other text is remembered, not lost

Card: joshualeestone/kosmos#6249. Cause measured in issuecomment 6931686222 (Agent1s board log, 2026-11-14 18:04Z:
box 448 characters, ours 292, read as other text over five more looks).

## What finished looks like

A line Kosmos typed into an agent's input box that also holds other text is no longer forgotten. It is kept with its
message number and retried, and it is pressed (by a retry or by the next delivery) only when the box shows exactly all
of it. The other text is never sent with it. Tests show this, and fail on the old code.

## The cause

engine/chat.js, finishSubmitSteps: when the box read as other text before our Enter, it returned UNCONFIRMED
`not-pressed` and kept nothing (no rememberUnsent, no scheduleUnsentRetries). settle() did the same for the after-Enter
`other` outcome (forgetUnsent). So the line was never sent unless a person pressed Enter on the mix, and the #6717
sweep later moves the whole box into a draft for the person, so the agent never hears it.

## The change

- `rememberMixed(target, wire, card)`: remembers the line with a new number, `seen: ''`, `mixed: true`, and starts the
  #6436 retries. Called from the not-pressed branch (its verdict now carries `unsentSeq`, which messages.js already
  records for any unsubmitted verdict) and from settle() for the after-Enter `other` outcome.
- `rememberedShows`: a `mixed` line counts only when the box shows all of it. A plain unsent line may also count by a
  long visible end in a scrolled box; a mixed one may not, because the rows above that end are where the other text was.
- `mixed` is kept on disk and loaded back, so a board restart keeps the rule.
- The two sentences a sender reads now say what happens next: pressed on its own only if the other text goes and the
  box shows just this line.

## Decided

- **Round 2 of the first #6249 review pinned "a line that met other text is not remembered".** Reversed here. That rule
  came before rounds 6 and 8 made every press need the box to hold exactly our line. With that in place, pressing a box
  that holds exactly our whole line sends only our words, whatever was there before. Leaving the old rule meant the
  agent never got the message.
- **Rejected: re-typing our line after the #6717 sweep drafts the box.** It would add an unattended paste path. Not
  needed for the stall (the sweep already ends it), and the sender was already told the line is sitting there unsent.
- **Rejected: pressing anyway.** It would send the other text as part of our message (case 1 on the card).

## Weakest premise

A person who deletes their own words and leaves exactly our line may have been about to edit ours too. A retry 30 s
later sends it. The same is already true of any plain unsent line today, so this adds no new kind of risk. It does add
one more case where it can happen. And in the not-pressed case someone was typing in that box under 2 seconds
earlier, so a person is likelier to be at it than for a plain unsent line, and the 30 s first retry is the one most
likely to land mid-edit. So a line kept beside other text skips the 30 s retry; its first press is the 2 min one.
Still bounded by the whole-line match.

## Stated limit

A line kept beside other text counts only in a box of 6 rows or fewer (STUCK_ROWS_MAX), because a box of 7 or more may
be hiding rows above, where that other text may be (measured for #6717: the box scrolls at 7 rows at pane heights 15,
24, 40 and 60; a pane under 15 rows is not measured). At 80 columns that is roughly 450 characters; a longer line is
never pressed once it met other text, even after the other text goes. The #6717 sweep then moves the box into a
draft after 10 minutes (when it is short enough to read whole) or leaves it. Accepting a visible end would risk the
other text sitting in the rows above it, which is the one thing this must never send. The sentence a sender reads says
so ("a line too long for the box never does"), and a test pins it.

## What would change my mind

If the "other" text turns out to be our own line drawn differently (the #8333 hypothesis), remembering does not help:
the box never shows our line whole, so it is never pressed, and the sweep drafts it. That would need a different fix
in composerHolds, not here.

## Tests

- engine/chat.notpressed-6249.test.js (new, 12 tests): the number on the verdict; the next delivery presses only after
  the other text goes; after-Enter `other` too; retries press only an exact box; an emptied box forgets it; a scrolled
  end of a mixed line is never pressed (CONTROL: a plain one is); the mark survives a restart.
- engine/chat.composer-6249.test.js: the round 2 test now pins the part that still holds (never pressed while the
  other text is there).
- Control 1 (re-measured after round 6): the new file against main's chat.js: 11 of 12 fail. The one that passes is the
  fold test (nothing kept), which holds on main because main keeps nothing.
- Control 2: with only the `if (kept.mixed) return false;` line removed, the scroll and restart tests fail.
- engine/autohandoff-log-8021.test.js: the board log's sentence for a line kept beside other text.
- Focused run: the chat composer/unsent/stuckinput/pastechip/chipshapes/8021 files: 135 pass. Guards
  (fixture-discipline, sandbox-data-4796, no-brand-refs, no-name-refs, engine.reachable) and engine/messages*: 387 pass.

## Review

Challenge loop, capped at 8 rounds unless a BLOCKER is open.

- Round 1 (blind, opus): no BLOCKER, 3 WARNING, 3 NIT.
  - WARNING fixed: every after-Enter `other` was kept, including answers that never saw our words (a lone chip, a box
    of chips, the re-read before the retry). Now only the arm that saw our end (`ours: true`) is kept; the
    not-pressed branch likewise keeps the line only when stillHoldsOurEnd reads our end in the box. The rest are
    forgotten as before.
  - WARNING fixed: the CONTROL test's title claimed a plain-line arm it did not have; it now has one, and a new test
    pins that a fold that never showed our words is not kept.
  - WARNING fixed: the sentences promised a later send even where nothing was kept; the old sentences stand, and the
    promise ("sends it later only if...", no longer "on its own") is added only when the line was kept.
  - NITs fixed: comments no longer claim the next delivery's look is exact, and drop the "emptied box forgets it"
    claim; weakest premise extended (someone was at that box under 2 s earlier).
- Round 2 (blind, sonnet): no BLOCKER, 2 WARNING, 3 NIT.
  - WARNING answered by decision and words: a long mixed line is never pressed (stated limit above); the sentence
    now says the whole line must show and that a line too long for the box never does.
  - WARNING fixed: the restart test's "whole" control drew a 1,700-character line unscrolled, a screen no pane
    draws; it now uses a 380-character line (5 rows) and a 4-row end of it. The scroll test is titled as the limit.
  - NITs: the retry re-read returning `other` without `ours` is commented as deliberate; `sawOurs` from the first
    read is kept (any press still needs an exact whole-line match); the test count (8) is right.
- Round 3 (blind, opus): no BLOCKER, 2 WARNING, 1 CONVENTION, 4 NIT.
  - WARNING fixed: the async re-read before the one retry, finding someone typing beside ours, still forgot the line;
    it now carries `ours` when our end is there, and a test drives that path.
  - WARNING fixed: the auto-handoff log said a kept line is "to be pressed later"; a line kept beside other text
    now says it is pressed only if the other text goes and the whole line shows (`keptMixed` on the verdict), tested.
  - CONVENTION fixed: Control 1 re-measured (8 of 10 fail on main).
  - NITs fixed: kept only when the box was read empty before our paste (`emptyBefore`); a line under 20 characters
    (spaces not counted) is never counted as seen; a note that an older board reads no `mixed`; the restart test
    has a plain-line control on the same screen.
- Round 4 (blind, sonnet): no BLOCKER, 2 WARNING, 3 NIT.
  - WARNING fixed: the stated-limit test never proved the line was kept, so its refusal could pass on an empty memory;
    it now asserts the kept verdict first.
  - WARNING fixed: the after-Enter path kept a line even when the box was not read empty before our paste, replacing
    an older record; it now needs `emptyBefore`, as the not-pressed path does.
  - NITs: `keptMixed` is set where the line is kept, not inferred from the outcome; the older-board note moved above the
    load; `seesOurs` being loose is accepted (it only keeps a line, never presses one).
- Round 5 (blind, opus): no BLOCKER, 2 WARNING, 3 NIT.
  - WARNING fixed (a round 4 slip): after round 4 required `emptyBefore` to keep a line, the sentence still promised a
    later send on `ours` alone; it now follows the keep. Test: a box unreadable before the paste keeps nothing and
    promises nothing (CONTROL: read empty first, kept and said).
  - WARNING fixed: a kept line counted as whole in a box of 7+ rows, which may hide rows above; now only in 6 rows or
    fewer, and a caller that gives no rows gets no press. Test with a plain-line control; the stated limit updated.
  - NITs fixed: the CONFIRM_WORDS header, the downgrade note's wording, the composer test title points at this file.
  - Mutation check: removing either new guard fails exactly its test.
- Round 6 (blind, sonnet): no BLOCKER, 3 WARNING, 3 NIT.
  - WARNING answered by measurement: a shorter pane scrolling sooner. The #6717 measurement already in the code (the
    box scrolls at 7 rows at pane heights 15, 24, 40 and 60) is now cited at the rule; under 15 rows is unmeasured.
  - WARNING fixed: a kept line skips the 30 s retry (someone was typing seconds ago); its first press is at 2 min.
  - WARNING (a note): the record a kept line replaces was already gone, since the box was read empty first; said in
    the comment.
  - NITs fixed: the downgrade note sits on the `mixed` spread; the plan's counts re-measured. Not acted on: a test of
    `keptMixed` without an unsentSeq (no path sets one without the other).
