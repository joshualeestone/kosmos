# mac-asleep-board-718: through Kosmos+, the board says it is the Mac and what to do from a phone (#718 state 2, board half)

Card: kosmos #4086 (Liu Kang), state 2 of Kano's list on #718 (issuecomment-5844683600). The iOS
half is its own PR (mac-asleep-ios-718). Stacked on state 1 (phone-offline-718), which edits the
same note painter; rebased onto main once state 1 merges. Touches web/index.html, so it waits for
the 0.7.01 page-merge hold like state 1.

## What happens today (Kano)
A phone whose reads get no answer (the Mac asleep or off) sees "Kosmos is not answering on this
computer" with "Open Kosmos from your Applications folder", and the agents card says "Something on
this computer did not answer" with an "Already use Terminal?" hatch. On a phone, "this computer" is
the phone, and neither remedy can be done from it.

## Finished looks like
- Viewed through Kosmos+ (kplusRemote), online, nothing answering: the top note says "Your Mac is
  not answering", "It may be asleep or turned off. Wake it and make sure Kosmos is open on it, and
  this page asks again by itself. If your Mac is on, check this phone or computer's own
  connection.", plus which address did not answer. No version line, no Applications folder.
- The agents card says "Something on your Mac did not answer" and offers no Terminal hatch.
- The Mac's own window (loopback) is unchanged: "this computer", the Applications-folder remedy,
  the hatch.
- Unit tests for both, each with a loopback control, fail on state 1's page; the state-1 browser
  check's CONTROL B (online phone, reads aborted) now also asserts the state-2 wording.

## Decisions
- **The phone's own connection is named too**, because a captive portal or dead Wi-Fi reports
  online and fails every read, which state 1 cannot see (its weakest part), so "your Mac" alone
  would sometimes be wrong. Rejected: a separate probe to tell them apart (a second failing request
  from a device that just failed one).
- **No version line through Kosmos+**: it describes this page, not the Mac, and a phone user has no
  use for it. The address that did not answer stays: it says which Mac.
- Wording reversible; "your Mac" as the Kosmos+ and state 3 copy say.

## Deliberately not done (challenge loop)
- A Windows board reached remotely keeps its Windows copy (Kosmos.exe remedy, "this computer"):
  the Kosmos+ wording is gated on not-Windows, and a test pins that it never says "your Mac".
  Kosmos+ remote access reaches Macs today (no Windows path in the connector, no remote copy in
  windowsCopyTable), the same call as state 3. If Windows gets remote access, this arm needs a
  windowsCopyTable entry.

## Weakest part
The card's "Something on your Mac did not answer" also shows for a read the Mac answered with an
error (a 500), as "this computer" did before. Making the card tell an answered error from silence
is its own change.

## State (2026-09-27, for a restarted session)
- Stacked on phone-offline-718. Challenge loop: iteration 1 done (header exception, Windows gate, browser check waits for the card), all pushed. Next: iteration 2 review, then full suite + browser checks, proof, PR (merge held with state 1 by the 0.7.01 page hold).
