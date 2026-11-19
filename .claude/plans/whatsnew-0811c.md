# whatsnew-0811c: #8728 part 2 joins 0.8.11's What's New

Follow-up to #8753 (part 1), before the 0.8.11 staging cut (#1050). Data only: one pool entry, the rebuilt `web/whats-new.json`, and this plan.

## Why
Splinter (14:43 CST 11-19): all three #8728 pieces are on main (#8739 d81b81430b, #8747 25c60b657d, #8755 2da068e7b1); name slices 1 and 2 in the What's New entry as remote sign-in from a laptop or phone no longer opening a browser on the far Mac and returning to the same dialog. Renet Tilley (author) posted the same two shas at 14:42.

## The entry
- **A remote Claude sign-in stays on your screen** (rank 8.7, top of the window, icon phone, no platform tag): "From a laptop or phone, a Claude sign-in opens no browser on the far computer, and its dialog returns after the Kosmos+ sign-in it asks for." (140 characters, the limit.)
- Slice 1 (#8747): a sign-in started from a remote session launches claude with BROWSER=/usr/bin/true on Mac and Linux, so no authorize tab opens there, and the page shows the link.
- Windows: #8744 (5e77d5309a, merged) taught the Windows sign-in host to honour noOpener, but main did not SET it there until #8759: engine/connect.js:1625 computed remoteStarted as false on win32 (`signinPlatform() !== 'win32'`). #8759 merged 15:0x CST as e60feee681 (CI 8/8 incl. windows); on main now, engine/connect.js:1626 reads `opts.remoteStarted === true` with no platform exclusion (checked by content). The branch is rebased onto it.
- Slice 2 (#8755): after the refusal that asks for a fresh Kosmos+ sign-in, the page reopens that account's dialog on return. web/index.html only, so every platform.

## Why no platform tag (again)
Iteration 1 tagged the line mac because Windows still opened a tab. With #8759 on main both Windows halves are in (#8744 honours noOpener, #8759 sets it), so the line is untagged again and says "the far computer". Splinter, 15:10: pin 0.8.11 at or after e60feee681 and drop the tag; Homer does a live remote sign-in on the 0.8.11 Windows staging build. The 0.8.11 pin must include e60feee681, or this line is false on Windows.

## The window after this (5)
1. A remote Claude sign-in stays on your screen (#8728 part 2, rank 8.7)
2. A restarted computer says it is still starting (#8728 part 1, 8.8)
3. to 5. #8699, #8719 part 1, #5167 (mac)
"Starring an agent shines" (9.6) leaves the window and stays pending. Mac shows 5, Windows 4 (one of the five is mac-tagged).

## Weakest premise
"its dialog comes back after the Kosmos+ sign-in it asks for" is shorter than #8755's guards: it comes back only within 10 minutes of the refusal, in the same browser tab, after pressing that refusal's own Sign in again. 140 characters leave no room for all of that; "it asks for" keeps it to that one sign-in.

## Would change my mind
A reviewer showing a remote sign-in that still opens a browser on a Mac, or that the dialog does not come back on the path the line names.

## Review log
- Before review, Renet Tilley (author of #8728) on Fleet Builders, 14:45: the line is right as written; with #8744 merged "opens no browser on the far computer" holds on every platform, and "from a laptop or phone" keeps it to remote starts. For notes, not the window: the dialog comes back only within 10 minutes of the refusal, in the same browser tab.
- Local: the five What's New test files, 60 tests, 0 failed, rc 0. whats-new-check.js 0.8.11 passes for mac (5) and windows (4) (before iteration 1; after the mac tag it reads mac 5, windows 3).
- Iteration 1 (opus): BLOCKER, the untagged line was false on Windows: #8744 reads noOpener, but engine/connect.js:1625 on main never sets it on win32, so a remote sign-in still opens a tab there; #8759 is the fix. The premise came from #8744's title, read, not run (the old weakest premise named exactly this), and Renet's 14:45 check repeated it. Fixed: mac tag, "a far Mac". WARNING, the plan restated that premise: corrected above. NIT taken: "after a Kosmos+ sign-in" became "after the Kosmos+ sign-in it asks for".
- Iteration 2 (sonnet): no new actionable findings (converged). Its WARNING, re-check #8759 at the 0.8.11 pin, is already the plan's rule above. NIT taken: the local-run line now gives the Windows count after the mac tag. NITs not changed: the dialog-return wording (the weakest premise above), and Starring leaving the window (by rank, as above).
- After iteration 2: #8759 merged (e60feee681). Rebased onto main, tag dropped, line back to "the far computer" (Splinter 15:10). Rebuilt: mac 5, windows 4.
