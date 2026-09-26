# badge-switch-4025: an in-app switch for the waiting count on the Kosmos icon

Card #4025 (follow-up to #3996). The Dock badge cannot be turned off today: macOS lists an app's Badges switch only once the app has asked for notification permission, and Kosmos does not ask.

## What finished looks like
- Settings > This computer has an "App icon" box with one switch, "Show the waiting count on the Kosmos icon", on by default.
- Off, /api/status serves counts.waiting as null, so the Mac Dock badge clears (the app already reads null as "no count", #3996's selftest row) and the Windows taskbar overlay, which reads the same field, clears too.
- On again, the number comes back on the next poll.
- The switch shows only once the board's setting is read; a failed read leaves no switch and a sentence, never a false Off. A click saves and draws what the board stored.

## Decisions
- **A Settings switch, not a notification-permission prompt** (the card's first option). The prompt is a system dialog nobody asked for, and one refusal cannot be taken back from inside Kosmos. Weakest premise: a person who expects macOS's own Badges switch finds it in Kosmos instead.
- **Stored on the board** (settings.json, key waitingBadge), not in the browser: the app polls the board itself when no page is open, so a per-browser choice would not reach it.
- **Off only on exactly false.** A missing or unreadable setting reads as the default, on: the count is harmless to show.
- **Null, not 0**, when off: 0 would also clear it, but null is already "no count" to both apps and does not claim nothing is waiting.
- **Placed beside Sounds**, in the same This computer section: both are how Kosmos gets the person's attention.
- **Nothing in the Mac app changes**: its badge already clears on null (#3996).

## Tests
- engine/status.waiting-badge-4025.test.js: off only on exactly false.
- server.test.js '#4025': default on, Off serves null, a non-boolean is refused and changes nothing, On again serves a number (fails with the route reverted).
- web.waiting-badge-4025.test.js: markup ships hidden with no aria-checked; read paints the stored position; failed read or an older board hides it and says so; a click saves the opposite and paints the board's answer; a refused save keeps the old position; an unloaded switch saves nothing.
- docs/browser-checks/render-waiting-badge-4025.js (hermetic): the same in a real browser, with shots.
