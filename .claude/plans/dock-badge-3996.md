# dock-badge-3996: a waiting count on the Mac Dock icon

Card #3996 (Josh, #admin, 2026-09-26 11:19): "is it possible to show a total number of waiting notifications on the kosmos app icon in the dock, like Messages app shows here? (would also be great to show on the windows task bar too)". Homer builds the Windows half.

## What finished looks like
With Kosmos open or closed to the Dock, the Kosmos icon shows a red number equal to what is waiting on the person: agents that need them, plus unread direct messages, plus unread project messages. It updates within about ten seconds of that changing, and the badge goes away at zero. The number is defined once in the engine and served by the board, so the badge and the in-app tiles agree. If the person has turned badges off for Kosmos in macOS, no badge.

## The count (decided; reversible)
`engine/status.js waitingTotal(counts, agents)` = `counts.needsYou` (the red "Needs you" tile's rule, needsPerson, offline trust rows included) + the sum of every agent's `dmUnread` (the Messages tile) + `counts.projectsUnread` (the Projects badge). The guide's row is left out, as the tiles leave it out. Unknown parts count 0, as the tiles do: a badge never shows a guess.
- Rejected: adding "Needs Your Decision" tasks (#3949) on top. A task needs the person's decision exactly when an agent holding it needs them (tasks.waitingOnPerson calls status.needsPerson), so that agent is already counted; adding tasks would count one question twice.
- Rejected: a new count the tiles do not show. The card asks that the badge and in-app counters agree; these three are the counters the page already shows.
- Weakest premise: unread project messages include agent-to-agent posts (the #670 "like Discord" ruling the Projects badge already follows). If the badge reads too high to Josh, the change is to count only posts addressed to the person, in this one function.
- The badge uses the raw server number; the page's tiles subtract the thread that is open on screen, which only the page knows. So while a thread is open the tile can read one lower than the Dock for up to one poll. Accepted: the Dock is seen when the window is not.

## Serving it
`/api/status` adds `counts.waiting`. No new route: the Mac app already reads `/api/status` with the board token (the #1042 stale check).

## The Mac app (native-app/main.swift)
- A repeating 10 s timer, started once the board's port is known, asks `/api/status` (token header, 8 s timeout, the stale check's request shape) and sets `NSApp.dockTile.badgeLabel` on the main thread. 10 s, not the page's 5 s: it runs in addition to the page's own poll.
- The label comes from a pure static function, `badgeLabel(fromStatus:)`: a whole number above zero becomes its digits (over 999 reads "999+"); zero, a missing or unreadable count, or no answer clears the badge. A board that did not answer clears it rather than leaving a stale number up.
- macOS settings: when Kosmos has a notification setting and its badges are off (UNNotificationSettings.badgeSetting == .disabled), no badge. Kosmos does not ask for notification permission to get one (that is a system dialog Josh did not ask for); without a setting the badge shows, as NSDockTile does for any app. Only inside a real bundle (UNUserNotificationCenter needs one).
- `--kosmos-app-badge-selftest` drives badgeLabel over its table; tools/build-kosmos-bundle.sh runs it like the stale selftest.

## Tests
- engine: waitingTotal over its parts, guide excluded, unknown as 0, and a control per part.
- server: /api/status carries counts.waiting equal to needsYou + DMs + projects on a real board.
- native: native-app.dock-badge-3996.test.js reads the Swift source (the timer, the main-thread set, the settings guard, the selftest rows); the selftest runs at bundle build.

## Not in this change
Windows taskbar overlay (Homer, reads the same counts.waiting). A served build with a real Dock screenshot is the card's done; that needs a cut.
