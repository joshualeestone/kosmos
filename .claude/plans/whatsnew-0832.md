# whatsnew-0832: the What's New pool after 0.8.31, for the 0.8.32 no-highlights cut

## Why there is no web/whats-new.json change
0.8.32 is cut with KOSMOS_CUT_NO_WHATS_NEW=1 (as 0.8.28 was). Nothing since 0.8.31 is worth a Mac highlight: the one
change a Mac can see (a receipt no longer keeps a closing quote in a Codex file name, #9314) is rare and was reasoned,
not seen. So no "Kosmos has been updated" window. (Review round 1 corrected my first wording, "nothing Mac-visible".) `whats-new-pool.js build 0.8.32` refuses ("it has no
highlights (1 to 5)"), which is the intended answer; web/whats-new.json stays for 0.8.31.

## What this changes (release/whats-new-pool.json only)
- What `build` recorded when it ran: lastProd 0.8.31 (prod and Windows prod both serve 0.8.31; prod-check exit 0) and
  0.8.31's highlight marked shown in 0.8.31.
- Three notes-only lines, all tagged windows:
  - since 0.8.31: #9271 (PR #9290) Undo after adding a found agent deletes its Scheduled Task; #9270 (PR #9291) the
    Muse turn log keeps logging after a cut. Both merged before the 0.8.31 freeze and shipped there with no pool line
    (the 0.8.31 versions entry already says both in words).
  - since 0.8.32, windows: a task receipt lists the files a Codex agent edited through a Windows path (#9263 PR #9316,
    #9314 PR #9323).
  - since 0.8.32, every platform: a task receipt no longer adds a closing quote to a Codex file name (#9314 PR #9323;
    engine/receipt.js has no platform check). Review round 1 found this one was owed to Mac and Linux too.
- The Muse entry is titled "keeps going when full": "after a cut" read as a release cut.
- Known gap, left on purpose: the 0.8.32 versions entry was copied into the running cut before this was found, so it
  names only the Windows-path half of the receipt fix; no edit under a running cut for one clause.
- Not given a line: #9285 (a swapped temp name is refused, never written in place): a save-safety fix a person would
  almost never see. It is in the 0.8.32 versions entry.

## Checks
- What's New tests by file: 86 pass, 0 fail. `notes 0.8.32` exits 0 for mac, linux and windows; mac carries no Windows
  line, windows carries both 0.8.32 lines and the two 0.8.31 ones; mac and linux carry the untagged one.

## Weakest premise
That these Windows-only fixes need no Mac highlight; if a later cut has a Mac-visible change, these notes ride with it.
