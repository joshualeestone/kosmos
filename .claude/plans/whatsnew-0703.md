# web/whats-new.json for 0.7.03 (#3955's window, first release to show it)

## Finished looks like
web/whats-new.json on main with version "0.7.03" and four one-line highlights of what a person updating from 0.6.99
would notice, passing tools/whats-new-check.js 0.7.03, before Baron's 0.7.03 cut.

## Content (Splinter's list, 2026-09-27 01:01)
1. Gemini on your Google subscription (#3998, shipped in 0.7.01; people updating from 0.6.99 see it now).
2. Gemini agents show Working / Idle / Needs you (#4043, PR #4106 merged).
3. The simpler Kosmos Plus page: the switch and Remove this computer (#4079 merged; #4080 PR #4110, green, merging after the running 0.7.01 cut).
4. The Tasks page (#3949 merged, PR #4095).

## Decided
- Line 3 describes #4080's switch. Weakest premise: #4110 lands before the 0.7.03 cut (it is green and held only for the
  running cut). If it does not, reword line 3 to Remove this computer only.
- The Dock count and the swarm daily limit (in the 0.7.01 draft) are dropped for Splinter's list; they shipped in 0.7.01.

## Re-targeted to 0.7.01 (Baron, 2026-09-27 01:45 CDT)

0.7.01 had not shipped (both cuts died at 3b), and #3955's gate means the 0.7.01 re-cut needs this
file for 0.7.01. Splinter decided (reversible) to ship the window in 0.7.01. So "version" is 0.7.01,
and line 3 is Mona's replacement: the old line described #4080's pause switch, which is held until
after the freeze; Remove this computer (#4079, 45db6d73) is on main. Each remaining line's feature
was checked on origin/main by ancestry: #3998 (307d8c14), #4043 (e943a4d9), #4079 (45db6d73),
#4095 (743711ea). `node tools/whats-new-check.js 0.7.01` passes; the same file for 0.7.03 is refused
(rc=3), so the check discriminates.
