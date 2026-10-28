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
