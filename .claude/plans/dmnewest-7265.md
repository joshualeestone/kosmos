# dmnewest-7265: a UI test that a long DM opens on its newest message (kosmos#7265)

Josh, 10-26: a long DM opened somewhere in the middle. The fix shipped in TestFlight build 8; the card waited on a phone.
Its done-line ("a DM with 200+ messages opens on its newest message") involves no hardware, so a simulator answers it.

## Finished looks like
- ChatOpensAtNewestUITests (opt-in, TEST_RUNNER_KOSMOS_UI_PLUS=1) opens Dana's long sample chat
  (KOSMOS_SAMPLE_LONG=varied: 220 messages of varied length, 40 older). Once the chat shows (its composer), its newest
  message must be there within 2 s, matched in its own bubble's label ("You, ...: Message 260 of 260."), and wholly
  between the top bar and the composer once the list is still.
- Control: a short drag leaves message 260 loaded but below the composer, and the same check must say it is not on
  screen (so the measurement itself can fail).
- Then two swipes up, Back, the chat proven closed (its composer gone), Dana's row hittable on the Agents list and
  tapped, and the chat must open on message 260 again.
- Measured 10-30 03:3x CDT on a fresh iPhone 17 Pro simulator, iOS 27: PASS three runs in a row, with screenshots of
  both opens, the control, and Agents after Back.

## Decided
- A test only; no app change. Rejected: a logic test of the scroll target, which cannot see where the list rests.
- Weakest premise: the 1.5 s settle before reading frames; a slower settle would read as a failure, never a false pass.

## Not in scope
- Staying at the newest message while messages arrive: needs a live board (#7420).

## Review ledger
- Round 1: no BLOCKER. WARNING, "Message 260 of 260." as a label PREFIX cannot match the bubble (its label starts
  "You, <time>:"); WARNING, "Dana" can match her bubbles, so the reopen was never shown. NITs: composer fallback to the
  window bottom; the message 250 control. All taken. A re-run then showed the composer was never found as a text view
  (it is a multi-line text field): found by its placeholder now. The message 250 control could not work (lazy list).
- Round 2: BLOCKER, with Back lost every later step could still pass (the Agents list stays in the tree under a pushed
  chat, and 260 was already gone after the swipes). WARNINGs: the control did not test the measurement; a late
  correction counted as opening on the newest. NITs: Back while the list coasts; debug prints. All taken: closed is
  proven by the composer going, the control drags 260 below the composer (loaded), first sight within 2 s, frames
  read once still, prints removed.
- One run with four fast swipes (before round 2's fixes) failed after Back; it matches round 2's blocker (a lost Back).
- Converged at round 2 (declared the last round before it ran): every finding taken, the control shown to work.

## Validation
- ChatOpensAtNewestUITests: PASS x3 after round 2's fixes, plus the earlier runs above. No app code changes.
