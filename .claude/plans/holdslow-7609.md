# holdslow-7609: the keyboard hold survives a slow did-show and re-looks after every correction

Card: kosmos#7609 (UI tests in CI). Main's ios "ui tests (sample board)" job went red on 5 of its last 10 runs. The most
frequent failure is KeyboardSlideUITests.testReadHigherUpStaysWhereItWas: a reader scrolled higher up is moved when the
keyboard comes up, which is what Josh would feel on a slow phone.

## What finished looks like

The keyboard hold (ChatView.swift, KeyboardHold) does not lose a reader's place for either of the two causes read from
main's CI traces, a source check pins both, and the PR's own CI ui tests job passes.

## Measured (main's CI traces, 11-04)

- Run 41780837713: will-show 687.62, did-show 691.04 (3.4 s). The did-show handler drops a reading older than 3 s as
  another keyboard's ("keyboard hold: skipped, stale"), so no correction ran. Content grew 830 pt above the reader as rows
  were measured; the reader moved 149 to 237.7.
- Run 41713564948: the row was not drawn at did-show and was placed by id. The settle found no good reading, retried, then
  read the row 27 pt off and corrected it. A retry's correction is never looked at again (only a first try's is, #7654), so
  a further move as the list settled stayed: the reader ended 149 to 168.7.
- Run 41700157014: the sample scroll-up rested with atBottom still true, so the chat went to the newest as designed. That
  is the test's own hook, not the hold; not in this branch.

## Change

- `KeyboardHold.staleAfter` (6 s) replaces the 3 s limit. A will-hide already clears another keyboard's reading
  (saved = nil), so the limit is only a backstop.
- `settleOnScreen(..., relooked:)`: the one look after a correction is asked after any correction, a retry's included.
  Still once: a re-look's own correction does not ask another.

## Decided

- 6 s, not 4: the measured 3.4 s came from a runner shared with other jobs, and a phone under load can be slower. Rejected
  removing the limit: it still bounds a reading whose did-show never came, for a keyboard of the same width.
- Review 1: a longer window keeps an orphaned reading longer (a will-show with no did-show, an iPad's floating keyboard,
  where will-hide is not guaranteed), and the usual put-back (holdTarget) does not check the row agrees with the list. So:
  the reading keeps its will-show's keyboard frame, and a did-show of a keyboard of another WIDTH skips it (width only: one
  keyboard's height flips, 380 and 608 on Josh's phone, #7817); and the reader's own scroll (a finger) between will-show
  and did-show drops the reading.
- Weakest premise: that a floating and a docked keyboard always differ in width. A docked keyboard after an orphaned
  docked will-show (same width, no will-hide) still gets the older reading, within 6 s. And a will-show or did-show
  without a keyboard frame skips the width check (fails open to the 6 s limit).
- Review 2, deferred by design: a drag starting between will-show and did-show drops the reading (nothing in the app sets
  isTracking/isDragging, so only a finger can). The room checks are text pins; the behaviour is CI's ui tests job.

## Tests

room/main.swift pins both (and that the old `!retried` re-look form is gone). Typecheck Release and DEBUG. The behaviour
itself is CI's ui tests job: it must pass on the PR, and main's red rate is the measure after merge.
