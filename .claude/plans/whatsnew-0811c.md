# whatsnew-0811c: #8728 part 2 joins 0.8.11's What's New

Follow-up to #8753 (part 1), before the 0.8.11 staging cut (#1050). Data only: one pool entry, the rebuilt `web/whats-new.json`, and this plan.

## Why
Splinter (14:43 CST 11-19): all three #8728 pieces are on main (#8739 d81b81430b, #8747 25c60b657d, #8755 2da068e7b1); name slices 1 and 2 in the What's New entry as remote sign-in from a laptop or phone no longer opening a browser on the far Mac and returning to the same dialog. Renet Tilley (author) posted the same two shas at 14:42.

## The entry
- **A remote Claude sign-in stays on your screen** (rank 8.7, top of the window, icon phone): "From a laptop or phone, a Claude sign-in opens no browser on the far computer, and reopens its dialog after a Kosmos+ sign-in."
- Slice 1 (#8747): a sign-in started from a remote session launches claude with BROWSER=/usr/bin/true on Mac and Linux, so no authorize tab opens there, and the page shows the link.
- Windows half (#8744, 5e77d5309a, merged 11:47 CST): a remote-started sign-in opens no tab on Windows either. #8759 (the Windows page's noOpener wording) is still open.
- Slice 2 (#8755): after the refusal that asks for a fresh Kosmos+ sign-in, the page reopens that account's dialog on return. web/index.html only, so every platform.

## Why no platform tag
engine/whatsnew.js tags only mac or windows; a mac tag would hide it on Linux, where slice 1 also applies. With #8744 merged the "opens no browser" half is true on all three, and slice 2 is page code. So the line names no platform and is untagged.

## The window after this (5)
1. A remote Claude sign-in stays on your screen (#8728 part 2, rank 8.7)
2. A restarted computer says it is still starting (#8728 part 1, 8.8)
3. to 5. #8699, #8719 part 1, #5167 (mac)
"Starring an agent shines" (9.6) leaves the window and stays pending.

## Weakest premise
"opens no browser on the far computer" on Windows rests on #8744's title and merge, read, not run. If Windows still opens something, the line is wrong there until #8759 or a fix.

## Would change my mind
Renet or Homer showing a remote sign-in that still opens a browser on some platform, or that slice 2 reopens the dialog only in some case narrower than "after a Kosmos+ sign-in" (it needs the press of the ask's own Sign in again, within 10 minutes).

## Review log
- Before review, Renet Tilley (author of #8728) on Fleet Builders, 14:45: the line is right as written; with #8744 merged "opens no browser on the far computer" holds on every platform, and "from a laptop or phone" keeps it to remote starts. For notes, not the window: the dialog comes back only within 10 minutes of the refusal, in the same browser tab.
- Local: the five What's New test files, 60 tests, 0 failed, rc 0. whats-new-check.js 0.8.11 passes for mac (5) and windows (4).
