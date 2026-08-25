# Plan: installing-progress

Josh, #chaoskosmos-design, 2026-08-25 15:09 and 15:20, live-testing a
fresh macOS account install. Filed as #892.

## Changes

1. **A K mark and progress bar stay visible in every state.** The page
   already had a spinner for the ordinary wait; the actual dead spot
   was the "taken" branch (something already answers the board's icon
   on the very first poll), which hid the spinner and showed nothing
   else. Root cause of the "taken" branch itself, confirmed via
   `lsof`: 127.0.0.1 sockets are shared across every macOS user
   account on one Mac, so a fresh test account's install page can see
   another account's already-running Kosmos.
2. **Settling, not hiding.** Both the mark and the bar freeze in place
   (stop animating) rather than vanish, on either conclusion (taken,
   or truly ready). A state that has actually been reached should read
   as reached, not as motion switched off mid-page.
3. **A real "Open Kosmos" link for the taken state.** The page still
   never navigates there automatically -- that refusal is the actual
   safety property, matching the installer's own BOARD_OURS gate -- but
   a person's own deliberate click is a different, safe act: they see
   the address, they choose, they can back out if it's wrong.

## Explicitly not built

The deeper multi-account isolation question (opening Kosmos from a
fresh account pulls in another account's agents and projects) --
Josh asked to discuss the architecture before anything gets built
there. Routed to Angel/Splinter.

## Verification

- [x] `npm test` (full suite) -- new file
      `install.installing-page.test.js` pins the mark/bar staying in
      the markup, `settle()` freezing rather than hiding, the Open
      Kosmos link's wiring, and that the taken branch still never
      calls `location.replace` on its own. 0 failures.
- [x] Real browser verification of both states (a standalone Node
      HTTP server answering the icon fetch immediately for "taken";
      nothing listening for the ordinary wait) -- screenshots confirm
      the mark pulses and the bar slides during the ordinary wait, and
      both settle solid with a working "Open Kosmos" button in the
      taken state.
- [x] This file has no server-backed browser-checks entry (it is a
      standalone page outside the served app, opened by a LaunchAgent
      during the .pkg install, not part of `web/index.html`), so the
      full `bash tools/browser-checks.sh` suite does not exercise it
      and was not expected to catch anything here either way.
