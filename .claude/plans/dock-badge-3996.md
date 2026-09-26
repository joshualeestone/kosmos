# dock-badge-3996: a waiting count on the Mac Dock icon

Card #3996 (Josh, #admin, 2026-09-26 11:19): "is it possible to show a total number of waiting notifications on the kosmos app icon in the dock, like Messages app shows here? (would also be great to show on the windows task bar too)". Homer builds the Windows half.

## What finished looks like
With Kosmos open or closed to the Dock, the Kosmos icon shows a red number equal to what is waiting on the person: agents that need them, plus unread direct messages, plus unread project messages. With the window open it follows the page's own 5 s poll; with it closed it updates within about ten seconds (macOS may stretch that for a windowless app; to be measured on a served build). The badge goes away at zero. The number is defined once in the engine and served by the board, so the badge and the in-app tiles agree.

## The count (decided; reversible)
`engine/status.js waitingTotal(counts, agents)` = `counts.needsYou` (the red "Needs you" tile's rule, needsPerson, offline trust rows included) + the sum of every agent's `dmUnread` (the Messages tile) + `counts.projectsUnread` (the Projects badge). The guide's row is left out, as the tiles leave it out. Unknown parts count 0, as the tiles do: a badge never shows a guess.
- Rejected: adding "Needs Your Decision" tasks (#3949) on top. A task needs the person's decision exactly when an agent holding it needs them (tasks.waitingOnPerson calls status.needsPerson), so that agent is already counted; adding tasks would count one question twice.
- Rejected: a new count the tiles do not show. The card asks that the badge and in-app counters agree; these three are the counters the page already shows.
- An agent that needs the person and also sent them a DM counts under both, exactly as the two tiles show it; the tile rule is kept rather than a new one.
- Weakest premise: unread project messages include agent-to-agent posts (the #670 "like Discord" ruling the Projects badge already follows). If the badge reads too high to Josh, the change is to count only posts addressed to the person, in this one function.
- The badge uses the raw server number; the page's tiles subtract the thread that is open on screen, which only the page knows. So while a thread is open the tile can read one lower than the Dock for up to one poll. Accepted: the Dock is seen when the window is not.

## Serving it
`/api/status` adds `counts.waiting`. No new route: the Mac app already reads `/api/status` with the board token (the #1042 stale check).

## The Mac app (native-app/main.swift)
- Two sources, one number. While the page polls the board it hands the app `counts.waiting` through a WKScriptMessageHandler (the main frame at the board's own 127.0.0.1 address and port only; a weak proxy, no cycle), so the app asks nothing extra of /api/status, the board's heaviest route. When the page has said nothing for 8 s (above its 5 s poll, below the 10 s timer, so a page gone quiet costs one tick at most) (window closed, page hidden or reloading), a 10 s timer (2 s tolerance, common run-loop mode so dialogs and menus do not stop it), started once the board's port is known, asks `/api/status` itself (token header, 8 s timeout, the stale check's request). Answers are applied in the order they were asked, on the main thread. A failed read is logged once and its recovery once.
- The label comes from a pure static function, `badgeLabel(fromStatusJSON:)` (and `badgeLabel(fromCount:)` for the page's number): a whole number above zero becomes its digits (over 999 reads "999+"); zero, a missing or unreadable count, or no answer clears the badge. A board that did not answer clears it rather than leaving a stale number up.
- macOS settings (card item 4): macOS lists an app under Notifications, with its Badges switch, only after the app asks for notification permission. Kosmos does not ask (a system dialog Josh did not ask for), so today there is no macOS switch to respect and the badge always shows; the code still checks badgeSetting == .disabled as a forward check (measured by review: an app that never asked reads .notSupported). The person's off switch is a follow-up card: an in-app setting.
- `--kosmos-app-badge-selftest` drives badgeLabel over its table; tools/build-kosmos-bundle.sh runs it like the stale selftest.

## Tests
- engine: waitingTotal over its parts, guide excluded, unknown as 0, and a control per part.
- server: /api/status carries counts.waiting equal to needsYou + DMs + projects on a real board.
- native: native-app.dock-badge-3996.test.js reads the Swift source (the timer, the main-thread set, the settings guard, the selftest rows); the selftest runs at bundle build.

## Review round 2
- The page's count is heard only from the board's own origin (127.0.0.1 and the resolved port), not any local host.
- The macOS badge setting is asked at most every 5 minutes.
- App Nap: the page's timer and the app's timer can both be slowed while the window is hidden; they are not independent under it. To be measured on a served build with the window closed; if the badge lags badly, the fix is a background activity while the window is hidden and the count is above zero.

## Review round 3
- Under the KOSMOS_URL test override the page on the chosen board still feeds the badge (its origin is recorded where the board is chosen); the app's own poll stays off there, and the log says so.
- A failed read is logged only after the board has answered once (a cold launch is not a fault); the label is set only when it changes; the badge-setting cache is main-thread only (dispatchPrecondition); on a board older than #3996 the page posts null, so the badge clears and the app does not poll.

## Review round 5
- A read that the board REFUSED (a wrong token) is logged at once with its code; no answer at all is still quiet until the board has answered once (cold launch).
- The badge clears only after three misses in a row (about 30 s): one slow answer on a busy board no longer blinks it off.
- A KOSMOS_URL without a port: WebKit's origin port 0 is read as the scheme's default on both sides.
- Left: an app poll and a page post can land out of the order they were asked in for one page tick (about 5 s); it corrects itself.

## Review rounds 6 and 7
- A 200 whose body does not read as the status is a miss (counted toward three), not an answer; a status with no count (an older board) is an answer and clears.
- A page post is a board read that worked, so it resets the app's miss count and its failing state.
- The quiet-page and setting timers use systemUptime, which never steps backwards.
- The selftest has rows for what reads as a status (18 rows).
- Left: the page posts its count before the rest of tick() paints its tiles; the Dock number is the server's, so a later tile error does not make it wrong. The server test's fixture has no unread project message; waitingTotal's parts each have a control in the engine test.

## Not in this change
Windows taskbar overlay (Homer, reads the same counts.waiting). A served build with a real Dock screenshot is the card's done; that needs a cut.
