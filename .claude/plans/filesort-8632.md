# filesort-8632: iPhone Files sort (kosmos#8632)

## Goal
An agent's and a project's Files screens on the phone (ios/Kosmos/FilesView.swift) get the board's four orders:
Newest first, Oldest first, A to Z, Z to A. Newest first by default, remembered on the phone per screen.
Folders stay above files, each group in the chosen order. A to Z matches the server's byName.

## Decisions
- **Where the rule lives:** Board.filesOrdered / filesSorted in FilesLogic.swift (UIKit-free, tested by
  ios/LogicTests/files). The view only applies it.
- **A to Z = server byName** (engine/projects.js: localeCompare, numeric, sensitivity base). Swift:
  `compare(options: [.caseInsensitive, .diacriticInsensitive, .numeric], locale: "en")`. Measured on 29 names
  against Node v26 (en-US): identical, ties included; the phone locale (nil) and en_US_POSIX each differed.
  Rejected: localizedStandardCompare (follows the phone's locale, which is not the board's).
- **Ties:** by name keep arrival order (the server's sort is stable); Z to A reverses names only, not ties.
- **By time:** no time last in both directions; same time falls back to A to Z.
- **Folders by time:** the browse route already sends `modified` for dirs; it is now read.
- **Remembered:** UserDefaults keys kosmos.filesSort.agent and kosmos.filesSort.project. Every agent and every
  subfolder share the agent key ("per screen", as the card says), rather than per agent.
- **Control placement:** the Agents list's sort Menu + Picker + SortButtonLabel, in the top bar trailing slot,
  shown only when the list has rows. On the project page (embedded, untitled) it appears in that page's bar while
  the Files segment shows; that page has no trailing item of its own.
- **Not changed:** the agent page's Files section (the newest ten from /files, the board's agent panel).

## Weakest premise
Node's localeCompare uses the board Mac's locale. On a Mac set to, say, Swedish, Å sorts after z on the board and
the phone (pinned "en") would differ for those names.

## Known limits
- An agent folder past 1000 entries arrives cut at the server's A to Z; sorting by date orders only what arrived.
  The cut-list footer now reads "Showing N, and the order covers only these." (it said "the first N", which no
  sorted order is; review 1). A project past 500 files is cut the same way.
- #8627 (the board side) is not merged yet; the words are the card's. Whether the board's A to Z uses the same
  byName is #8627's to decide; a note was left on that card (review 1).

## Tests
ios/LogicTests/files: words, default, saved value, per-screen keys, byName parity vs the Node-measured order (with a
control that can fail), Z to A ties, newest/oldest with missing and equal times, a real browse answer in all four
orders, A to Z equal to arrival order, leading zeros and versions. Mutants: dropping .numeric fails 1; flipping
nils-last fails 2. Of the runners, only run-files.sh compiles FilesLogic.swift (grep, 11-17); all 13 runners in
ios/LogicTests were run on 11-17 and passed. The screen itself (menu, remembered key, toolbar) has no automated test:
there is no UI test target, so it is the card's device check.

## Done when (card)
On a phone against a real board: a file saved a minute ago is on top by default; all four orders sort both
screens; A to Z matches today's agent list. Needs a device: parked needs-device after merge if not done here.
