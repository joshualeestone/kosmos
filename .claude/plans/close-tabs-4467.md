# close-tabs-4467: every agent is told to close the browser tabs it opens

Card: joshualeestone/kosmos#4467 (Josh, #admin 2026-09-28 22:07: agents leave "literally hundreds" of
tabs open in his browser). Routed by Splinter, claimed by Angel.

## Finished looks like
Every agent's instruction file, on every provider and on Mac and Windows, carries a section telling
it to close every browser tab or window it opens when done, to fetch a page rather than open it in
the person's browser, to open the person's browser only when they must see or act, and to say so
when it opened a tab it has no way to close. Existing agents are offered it too. Tests hold the
words. The behaviour (an agent actually closing a tab) is measured after the release reaches agents.

## Decisions
- One NEW `###` section in `engine/defaults.js` BLOCK, "Close the browser tabs you open", placed
  after "Look before you install". A new heading because `missingFrom` matches by heading: that is
  what makes the consented refresh offer it to agents that already exist (versions 5 to 15's log).
- DOCTRINE_VERSION 15 -> 16 with a log entry; fingerprint pinned in defaults.test.js.
- Provider coverage: the block is one text appended to every runner's instruction file
  (CLAUDE.md, AGENTS.md, GEMINI.md) by create.js / discover.js / roles.js, so no per-provider copy.
- Windows parity: there is no separate Windows copy (create.js appends the same block on win32).
  Pinned by one line in engine/create.test.js's "taught how to work" test, which reads a real
  created agent's boot file and is on the Windows CI list. Rejected: the same line in
  win32codexreply.e2e.test.js, which is skipped on Mac and excluded from Windows CI, so it would
  never run.
- Copy names both `open` (Mac) and `start` (Windows) for the no-handle case.
- Not built: the card's optional item 3 (a count of agent-opened tabs). Kosmos keeps no record of
  which tabs an agent opens, so it is not cheap.

## Weakest premise
That a written rule changes what agents do with the browser. Agents that open a page with a plain
`open` have no handle to close it; the rule makes them say so rather than go silent, but the tab
stays. Measured only after release.

## Verified
- defaults.test.js 22/22 (the new content test and the pinned fingerprint), doctrine.test.js 13/13,
  create.test.js boot-file tests 4/4 and the "taught how to work" test.
