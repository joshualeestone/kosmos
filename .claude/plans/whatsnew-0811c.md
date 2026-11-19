# whatsnew-0811c: #8728 part 2 joins 0.8.11's What's New

Follow-up to #8753 (part 1), before the 0.8.11 staging cut (#1050). Data only: one pool entry, the rebuilt `web/whats-new.json`, and this plan.

## Why
Splinter (14:43 CST 11-19): all three #8728 pieces are on main (#8739 d81b81430b, #8747 25c60b657d, #8755 2da068e7b1); name slices 1 and 2 in the What's New entry as remote sign-in from a laptop or phone no longer opening a browser on the far Mac and returning to the same dialog. Renet Tilley (author) posted the same two shas at 14:42.

## The entry
- **A remote Claude sign-in stays on your screen** (rank 8.7, top of the window, icon phone, platforms ["mac"]): "From a laptop or phone, a Claude sign-in opens no browser on a far Mac, and its dialog comes back after the Kosmos+ sign-in it asks for."
- Slice 1 (#8747): a sign-in started from a remote session launches claude with BROWSER=/usr/bin/true on Mac and Linux, so no authorize tab opens there, and the page shows the link.
- Windows: #8744 (5e77d5309a, merged) taught the Windows sign-in host to honour noOpener, but main never SETS it there: engine/connect.js:1625 computes remoteStarted as false on win32 (`signinPlatform() !== 'win32'`), so a remote sign-in still opens a tab on a Windows computer. #8759 (open) removes that exclusion.
- Slice 2 (#8755): after the refusal that asks for a fresh Kosmos+ sign-in, the page reopens that account's dialog on return. web/index.html only, so every platform.

## Why the mac tag
The "opens no browser" half is false on Windows until #8759 merges (above), so the line is tagged mac and names the Mac. engine/whatsnew.js tags only mac or windows, and a mac tag hides it on Linux, where slice 1 also applies: that under-claims on Linux, the safe direction. If #8759 is on main at the 0.8.11 pin, drop the tag and say "far computer" (rebuild and re-check).

## The window after this (5)
1. A remote Claude sign-in stays on your screen (#8728 part 2, rank 8.7)
2. A restarted computer says it is still starting (#8728 part 1, 8.8)
3. to 5. #8699, #8719 part 1, #5167 (mac)
"Starring an agent shines" (9.6) leaves the window and stays pending. Mac shows 5, Windows 3 (two of the five are mac-tagged).

## Weakest premise
"its dialog comes back after the Kosmos+ sign-in it asks for" is shorter than #8755's guards: it comes back only within 10 minutes of the refusal, in the same browser tab, after pressing that refusal's own Sign in again. 140 characters leave no room for all of that; "it asks for" keeps it to that one sign-in.

## Would change my mind
A reviewer showing a remote sign-in that still opens a browser on a Mac, or that the dialog does not come back on the path the line names.

## Review log
- Before review, Renet Tilley (author of #8728) on Fleet Builders, 14:45: the line is right as written; with #8744 merged "opens no browser on the far computer" holds on every platform, and "from a laptop or phone" keeps it to remote starts. For notes, not the window: the dialog comes back only within 10 minutes of the refusal, in the same browser tab.
- Local: the five What's New test files, 60 tests, 0 failed, rc 0. whats-new-check.js 0.8.11 passes for mac (5) and windows (4).
- Iteration 1 (opus): BLOCKER, the untagged line was false on Windows: #8744 reads noOpener, but engine/connect.js:1625 on main never sets it on win32, so a remote sign-in still opens a tab there; #8759 is the fix. The premise came from #8744's title, read, not run (the old weakest premise named exactly this), and Renet's 14:45 check repeated it. Fixed: mac tag, "a far Mac". WARNING, the plan restated that premise: corrected above. NIT taken: "after a Kosmos+ sign-in" became "after the Kosmos+ sign-in it asks for".
