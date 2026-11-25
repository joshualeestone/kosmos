# whatsnew-0822: the What's New list for 0.8.22

Built with `node tools/whats-new-pool.js build 0.8.22` (online) on origin/main at 6586b52bf3. It is the step before the
0.8.22 staging cut, which the gap alarm asked for on #1050.

## What the build did
- Read Mac prod 0.8.21 and Windows prod 0.8.21. It marked 0.8.21's window shown and recorded lastProd and lastProdWin as
  0.8.21, so 0.8.21's three highlights leave the pending list.
- That leaves only this cut's three new highlights pending: the Mac and Linux window shows three, Windows two (the
  permission one is tagged mac).

## Pool additions (merged after the v0821 bump)
- **A waiting agent says why** (#8991, PR #9008, rank 10). Read from #9008's "What changes": the reason is in the status
  pill's hover and its screen reader text, and nothing is added to the tile. So the line says "point at a waiting agent's
  status", not "its card says". The first wording claimed the card itself, which #9008 rules out.
- **Built but waiting** (#9011 part 2, PR #9023, rank 11). The pill shows when nothing is running, nobody needs the person,
  and at least one open task is built (`builtWaiting > 0`, engine/projects.js). The first wording said "all built", which
  the code does not require; review caught it. It is the last pill in the order, so a paused project still says Paused
  and one with a question still says Question: hence "an active project with nothing running".
- **Commands that would stall are refused up front** (#9001 part 2, PR #9013, notesOnly, rank 148). Agent-facing: the
  report hook's refusal message. It is in install/kosmos-report-hook.sh only, the Mac and Linux hook; the Windows hook
  (engine/kosmos-report-hook.js) has none of it. So it is tagged ["mac"]: the pool refuses a line that names the Mac
  without a tag, and an untagged one would tell Windows agents about a guard they do not have. The cost: releasenotes.js
  never tags Linux, so Linux agents, which do have the guard, lose this one note. Wrong on Windows was the worse error.
  The line names the two shapes it covers.
- **kosmos project show gives last activity** (#8996 slice 1, PR #9006, notesOnly, rank 149). An agent's command.

- **Long permission requests can be allowed** (#8952 slice d, PR #9003, mac, rank 9). Not only the phone: the engine grows
  an unviewed Claude agent's tmux window until a long command's permission box draws whole, so the board gets the normal
  card with Allow (it could only refuse a cut box before). tmux-based, so tagged mac (Linux reads the Mac list); Windows
  agents have no tmux window. First filed under "iPhone only" here, which review showed was wrong: #9003 changes
  engine/permgrow.js, engine/chat.js, engine/status.js and server.js.

## Not added
- #8990 (PR #9025): an idle board stops rebuilding its cards and refetching every avatar each poll (32 rebuilds and 16
  fetches in 40 s, measured on the PR), and a picture that fails to load asks again. Real, but not worth a line.
- #8999 (PR #9009): an internal receipt read.
- #9016, #8959 B1c: the iPhone app, which ships through TestFlight, not this window.
- #9020, #8993, the #185 test fix: CI and tests only.

## Platform tags
The permission highlight is tagged mac (above). The other two highlights are web-board changes that every platform's board runs (#9023 also changes engine/projects.js, which is
shared). So the list is the same on Mac, Windows and Linux.

## Checks
- `whats-new-check.js 0.8.22 --platform=mac` and `--platform=windows`: exit 0. Linux is not a platform the check takes
  (usage exit 2); Linux reads the Mac list.
- The 8 test files that read these two files: 527 pass, 0 fail.

## Weakest premise
That "point at" is how the person meets the reason. It is the pill's hover on a pointer device and its screen reader
text. On a touch screen there is no hover, so a person on a touch browser who opens the board is not shown how to reach
it. The window is the desktop board's; the iPhone app is separate and ships through TestFlight.
