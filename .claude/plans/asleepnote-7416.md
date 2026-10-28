# asleepnote-7416: the board's "isn't answering" note names the computer and when it was last heard from (kosmos#7416 slice 1)

## Why
An outside user runs ~35 agents on one Mac and reaches them from a laptop and an iPad over Kosmos+. When the Mac sleeps
the other devices just stop answering. The board already says "Your Mac is not answering. It may be asleep or turned
off" through Kosmos+ (#718 state 2), but never names the computer and never says when it last answered.

## The change (Mona Lisa's words, card #7416)
- The remote note's title is the computer's own name when Kosmos+ has told the page (THIS_COMPUTER_NAME, from Your
  computers), else the generic "Your Mac": "Studio isn't answering".
- Its first sentence is "It may be asleep, off or offline." (MAC_ASLEEP_SENTENCE on a Mac; Linux and the cloud machine
  keep theirs).
- After that first sentence: "We last heard from it at 8:12 PM." from LAST_STATUS_OK_AT (the page's last good status
  read), in the person's clock: the time today, "yesterday at", "on Tuesday at" within a week, "on Oct 21" before.
  Left out when the page never heard from it (opened from the cache while the computer slept).

## Decided
- Never asserts "asleep": from another device asleep, off and offline look the same, so it is one hedged list.
- The #718 rule that the remote note names no cause it cannot know is kept: "offline" is allowed only inside the hedged
  "may be asleep, off or offline", where Mona put it, and refused anywhere else (where it would be the phone's own
  "You are offline"). Flagged to Mona on the card; "asleep or off" is the one-line alternative.
- Slices 2 (iPhone and iPad) and 3 (keep the computer awake while agents work) are their own PRs.

## Weakest premise
That THIS_COMPUTER_NAME is current when the computer stops answering. It is read from Your computers (Kosmos+) and kept
across a failed read, so a rename on another device shows the old name until the next answer, which is still a name the
person knows.

## Review rounds
1. (general-purpose, 23:1x CDT) 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 5 NITs; all applied.
   - (W) the note painted once and never again while the computer stayed down, so "at 11:50 PM" left overnight read as
     tonight, and (W) a name that arrived after the first paint never showed: the remote arm's guard keys on the
     sentence itself, so it repaints when the name or the day's words change, and never re-announces otherwise (test
     over midnight and a late name; the old key reds it).
   - (W) the splice was never run on the real MAC_ASLEEP_SENTENCE: the new test lifts it, and the #5865 test asserts the
     time lands after the first sentence on the Mac's and Linux's own words.
   - (W) render-phone-offline-718 asserted nothing new: it checks the heard sentence after the first sentence.
   - (C) the docblock and the remote-arm comment describe the new note and the narrowed "offline" rule. (C) why this is
     not rebootWhen or seenAtWords is in its comment (Mona's words drop the clock after a week and spell the weekday);
     the locale argument is [] like the others.
   - NITs: a fixed clock in the tests; the weekday variable named for Wednesday; a 30 s future case; the body says "If it
     is on", so a named title never names a second machine; the splice looks for any sentence end ([.!?] ).
   - Not done: a daylight-saving test (the runner's zone is fixed at start; the calendar-day count is by local dates).
