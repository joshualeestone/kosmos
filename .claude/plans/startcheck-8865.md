# startcheck-8865: an agent can read what the start's file check found (kosmos#8865)

Finished means: after a crash restart, an agent runs `kosmos start-check` (Mac or Windows) and reads the same facts the
page shows about this start's check of Kosmos's own data files: whether it ran, how many files it looked at, how many it
could not, which are damaged and what each holds, and whether a good copy is kept. After a clean start it says checked,
nothing damaged. It never scans by hand, and never hears "fine" about files the check could not see.

## Measured first (installed 0.8.13, build 14c4a37364, Agent1s)

`kosmos start-check` is unknown, `kosmos --help` names no such command, and `kosmos status` says only that Kosmos is
running. The page reads GET /api/board/damaged-files, which lists damaged files only (not whether the check ran or
how much it saw), and no CLI verb reads it.

## The call

- `engine/storecheck.js`: the scan counts the files it looked at (`LOOKED`, never overlapping `unread`), `dismiss()`
  records that the person dismissed the list, and `report()` returns `{ ran, checked, damaged, unread, looked,
  restored, dismissed, files }`, where `restored` counts what was put back since the start (said even after a
  dismissal; a shorter list is never read as put back), and `files` is the page's own list (current()) with each problem in the board log's words.
  `lastScan()` keeps its shape, because the restart note stores it and #8287's tests pin it.
- `server.js`: GET /api/board/start-check answers report(), read-only, beside /api/board/damaged-files and under the
  same gate.
- `engine/startcheckwords.js` (requires nothing): the sentences, so both CLIs print the same words. It says "none is
  damaged" only when the scan ran and nothing was unread.
- `kosmos start-check` on the Mac (install/kosmos) and on Windows (tools/windows/kosmos-cli.js), with one help line,
  the same on both.

Rejected:
- Adding the facts to `kosmos status`: status answers "is it running" for scripts; mixing in a file report changes what
  its output means.
- Telling the agent through the restart note: that note is the page's; how a reboot reaches the conversation is #8864.
- Building on crashcheck-8863: it cannot merge under the 0.8.14 hold. This builds on main and rebases onto it; Renet
  Tilley agreed (m5665). After the rebase, `looked` also counts #8863's .jsonl files and folders, and a .jsonl the person
  already dismissed counts as looked at, not damaged.

Exit status: 0 whenever the board answered, whatever it said (no result, some unread, damaged or clean), as
`kosmos accounts` does; the words are the answer. A script that needs to branch reads them. Decided in review round 3,
before any agent scripts against it.

Weakest premise: that an agent will think to run `kosmos start-check`. The help line names it for "after a crash"; a
line in the restart message an agent sees would reach it without that, and that belongs to #8864.

What would change my mind: an agent after a crash restart that still scans by hand with this command available.

## Tests

- `server.startcheck-8865.test.js`: the real board started with two planted damaged files; the route's counts and list;
  the real Mac CLI names both with what each holds and the good copy; the Windows CLI prints the same words from the
  same answer. CONTROL: a clean start says checked, nothing damaged.
- `engine/startcheckwords-8865.test.js`: no result is never "fine"; unread is never "fine"; a secret file, a file saved
  since the start, a dismissed list and a file already put back each get their sentence.
