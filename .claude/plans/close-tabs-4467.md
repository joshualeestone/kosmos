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
  what makes the consented refresh offer it to agents that already exist (the version log, entries 5 to 8).
- DOCTRINE_VERSION 15 -> 16 with a log entry; fingerprint pinned in defaults.test.js.
- Provider coverage: the block is one text appended to every runner's instruction file
  (CLAUDE.md, AGENTS.md, GEMINI.md) by create.js / discover.js / roles.js, so no per-provider copy.
- Windows parity: there is no separate Windows copy (create.js appends the same block on win32).
  Pinned by one line in engine/create.test.js's "taught how to work" test, which reads a real
  created agent's boot file and is on the Windows CI list. Rejected: the same line in
  win32codexreply.e2e.test.js, which is skipped on Mac and excluded from Windows CI, so it would
  never run.
- Copy names both `open` (Mac) and `start` (Windows) for the no-handle case.
- A page that only works in a real browser: the agent's own private browser (engine/agentbrowser.js,
  headless and isolated, never the person's), named conditionally because not every agent has it.
  When the person needs to see a page, give them the address; open their browser only when they
  must act now (a sign-in, a payment). Never `open`/`start` a link just to read it, rather than
  a report for every such tab. Lines up with "Send readable messages" (paste a bare address).
- Not built: the card's optional item 3 (a count of agent-opened tabs). Kosmos keeps no record of
  which tabs an agent opens, so it is not cheap.

## Weakest premise
That a written rule changes what agents do with the browser. Measured only after release. The
Windows check shows the text reaches a Windows-created boot file; the block has no win32 branch, so
there is no separate Windows wording to diverge.

## Verified
- defaults.test.js 22/22 (the new content test and the pinned fingerprint), doctrine.test.js 13/13,
  create.test.js boot-file tests and the "taught how to work" test (5/5).
