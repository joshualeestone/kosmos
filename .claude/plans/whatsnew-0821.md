# whatsnew-0821: the What's New list for 0.8.21

Built with `node tools/whats-new-pool.js build 0.8.21` (online) on origin/main at ce3c61f8ee.

## What the build did
- Read Mac prod 0.8.20 and Windows prod 0.8.20 and marked 0.8.20's window shown, recording both (lastProd and lastProdWin 0.8.20).
- Picked the pending highlights by rank. Only three are pending and not notes-only, so the window has three.

## Pool additions
- **A restarted agent says why** (#8979, PR #8987, windows, rank 13.5): "On Windows, when a Claude agent stops and Kosmos starts it again, its card says when and why, such as a sign-in or a usage limit." Read from #8987's "What changes for the person" and its browser check's rendered words. Windows only: the Mac supervisor has no publisher yet (#8987 "Not in this change").
- **Agents can see whether a message was read** (#8961, PR #8976, notesOnly, since 0.8.20, rank 140): "kosmos msg --status says whether a message was answered, read with no answer, not read yet, or never delivered." (Review: the first wording left out "not read yet", the CLI's most common pending answer, and named only the rare never-delivered one.) It shipped in 0.8.20 without a line (merged before that cut's pin); it is agent-facing, so notes only, as recorded on #8961.

## Not added
- #8992 (PR #8995): the feedback pull's own wording, an internal tool.
- #8952, #8954, #8956, #8959, #8966: the iPhone app, which ships through TestFlight, not this window.

## The list (3)
- windows: A restarted agent says why (since 0.8.21)
- mac: A failed download gives the system's reason (since 0.7.95)
- mac: A Meta agent out of quota says so (since 0.7.76)

Per platform: Mac 2, Windows 1 (Linux reads the Mac list). The two Mac lines are the only other pending ones; neither was in a window prod users saw.

## Checks
- The build's own check (engine/whatsnew.js problems) is clean.

## Weakest premise
That the Windows line holds on a real Windows box: it rests on #8987's tests and browser check, not a restart seen on a Windows card (#8987 names that as not yet done).
