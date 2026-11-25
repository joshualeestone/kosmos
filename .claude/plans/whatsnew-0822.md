# whatsnew-0822: the What's New list for 0.8.22

Built with `node tools/whats-new-pool.js build 0.8.22` (online) on origin/main at 6586b52bf3. It is the step before the
0.8.22 staging cut, which the gap alarm asked for on #1050.

## What the build did
- Read Mac prod 0.8.21 and Windows prod 0.8.21. It marked 0.8.21's window shown and recorded lastProd and lastProdWin as
  0.8.21, so 0.8.21's three highlights leave the pending list.
- That leaves only this cut's two new board highlights pending, so the window has two.

## Pool additions (merged after the v0821 bump)
- **A waiting agent says why** (#8991, PR #9008, rank 10). Read from #9008's "What changes": the reason is in the status
  pill's hover and its screen reader text, and nothing is added to the tile. So the line says "point at a waiting agent's
  status", not "its card says". The first wording claimed the card itself, which #9008 rules out.
- **Built but waiting** (#9011 part 2, PR #9023, rank 11). The pill shows when nothing is running, nobody needs the person,
  and the open tasks are built.
- **Commands that would stall are refused up front** (#9001 part 2, PR #9013, notesOnly, rank 148). Agent-facing: the
  report hook's refusal message.
- **kosmos project show gives last activity** (#8996 slice 1, PR #9006, notesOnly, rank 149). An agent's command.

## Not added
- #8990 (PR #9025): the board stops refetching avatars on an idle poll. Nothing a person sees changes.
- #8999 (PR #9009): an internal receipt read.
- #9016, #8952 d, #8959 B1c: the iPhone app, which ships through TestFlight, not this window.
- #9020, #8993, the #185 test fix: CI and tests only.

## No platform tags
Both highlights are web-board changes that every platform's board runs (#9023 also changes engine/projects.js, which is
shared). So the list is the same on Mac, Windows and Linux.

## Checks
- `whats-new-check.js 0.8.22 --platform=mac` and `--platform=windows`: exit 0. Linux is not a platform the check takes
  (usage exit 2); Linux reads the Mac list.
- The 8 test files that read these two files: 527 pass, 0 fail.

## Weakest premise
That "point at" is how the person meets the reason. It is the pill's hover on a pointer device and its screen reader
text. On a touch screen there is no hover, so the line is right for the Mac and Windows boards in a browser, and says
nothing about the phone.
