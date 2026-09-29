# close-tabs-4467: every agent is told to close the browser tabs it opens

Card: joshualeestone/kosmos#4467 (Josh, #admin 2026-09-28 22:07: agents leave "literally hundreds" of
tabs open in his browser). Routed by Splinter, claimed by Angel.

## Finished looks like
Every agent's instruction file, on every provider and on Mac and Windows, carries a section telling
it to close every browser tab or window it opens when done; never to open a page in the person's
browser just to read it (fetch it, use its own private browser if it has one, or say it cannot read
the page and give the address); and that the one exception is a page the person must act on now
(a sign-in, a payment), opened, said so, and left open for them. `open`/`start` leave a tab with no
way to close it, so they are only for that exception. Existing agents are offered it too. Tests hold
the words. The behaviour (an agent actually closing a tab) is measured after the release.

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
- Copy names both `open` (Mac) and `start` (Windows) as the way that leaves a tab with no handle.
- Three paragraphs: the rule (close what you open, nothing "for later", the exception flagged);
  never open a page in the person's browser just to read it (fetch it; for a page that must be
  rendered, the private browser from engine/agentbrowser.js, named by its kosmos-browser tools and
  conditionally, since only Claude agents on Mac and Windows have it; otherwise say you cannot read
  it and give the address); the one exception, a page they must act on now, opened and said so.
- Not built: the card's optional item 3 (a count of agent-opened tabs). Kosmos keeps no record of
  which tabs an agent opens, so it is not cheap.

## Weakest premise
That a written rule changes what agents do with the browser. Measured only after release. The
Windows check shows the text reaches a Windows-created boot file; the block has no win32 branch, so
there is no separate Windows wording to diverge.

## Verified
- defaults.test.js 22/22 (the new content test and the pinned fingerprint), doctrine.test.js 13/13,
  create.test.js boot-file tests and the "taught how to work" test (5/5).
