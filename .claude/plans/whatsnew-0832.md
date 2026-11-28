# whatsnew-0832: the What's New pool after 0.8.31, for the 0.8.32 no-highlights cut

## Why there is no web/whats-new.json change
0.8.32 is cut with KOSMOS_CUT_NO_WHATS_NEW=1 (as 0.8.28 was). Nothing since 0.8.31 is visible on a Mac, so there is no
honest highlight and no "Kosmos has been updated" window. `whats-new-pool.js build 0.8.32` refuses ("it has no
highlights (1 to 5)"), which is the intended answer; web/whats-new.json stays for 0.8.31.

## What this changes (release/whats-new-pool.json only)
- What `build` recorded when it ran: lastProd 0.8.31 (prod and Windows prod both serve 0.8.31; prod-check exit 0) and
  0.8.31's highlight marked shown in 0.8.31.
- Three notes-only lines, all tagged windows:
  - since 0.8.31: #9271 (PR #9290) Undo after adding a found agent deletes its Scheduled Task; #9270 (PR #9291) the
    Muse turn log keeps logging after a cut. Both merged before the 0.8.31 freeze and shipped there with no pool line
    (the 0.8.31 versions entry already says both in words).
  - since 0.8.32: a task receipt lists the files a Codex agent edited through a Windows path (#9263 PR #9316, #9314
    PR #9323).
- Not given a line: #9285 (a swapped temp name is refused, never written in place): a save-safety fix a person would
  almost never see. It is in the 0.8.32 versions entry.

## Checks
- What's New tests by file: 86 pass, 0 fail. `notes 0.8.32` exits 0 for mac, linux and windows; mac carries no Windows
  line, windows carries all three.

## Weakest premise
That these Windows-only fixes need no Mac highlight; if a later cut has a Mac-visible change, these notes ride with it.
