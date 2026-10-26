# updwait-7207: an Update press with no answer waits for Kosmos

Card: kosmos#7207 (Josh, 2026-10-26 10:28, board 10102026, staging 0.7.68 to 0.7.69): after Update the dialog said
"Kosmos did not answer, so this page cannot tell whether the update started ..." and offered Update again; he pressed
it "like a million times".

## Measured (from the code)
- The dialog's no-answer branch (`!res`, the POST threw) re-enabled Update with that sentence. No answer is exactly
  what a press gets when the board restarts, very often to install the update a press already started.
- Repeated presses do not start a second install: server.js /api/update answers `already: true` and joins while
  updates.alreadyInstalling() is true (it stays single-flight). A press while the board is down gets no answer at all,
  so the "million" presses hit a board that could not hear them.

## Decided
- On no answer the dialog waits: it says so, turns the button off ("Waiting..."), and asks /api/status every two
  seconds until the board answers or the dialog is closed. One pure function (unansweredPressVerdict) decides:
  - a new version answers: reload into it (the update happened);
  - a new boot on the same version: "Kosmos restarted and is still on X. Press Update to update it now.";
  - the same boot answers: "Kosmos is answering again. Press Update to update: if it already started, this joins it."
    (/api/status does not say whether an install is running, so this never claims it did not start);
  - three minutes with no answer: say so and offer Reload.
- Roll back gets the same wait with its own words.

## Rejected
- Reusing the full-screen "Updating" overlay for no-answer: it would claim an update is under way when the page does
  not know one started.
- Reading "same boot answering" as "the update did not start": not knowable from the status the board gives.

## Proven
- web.update-unanswered-7207.test.js: every branch of the verdict, its precedence (a new version wins over a new
  boot; nothing known from before is never "done"), and the wiring (no answer goes to the wait; the button is off; a
  closed dialog stops asking).
- docs/browser-checks/render-update-toast.js: a stubbed no-answer press shows the waiting sentence with the button
  off, then (the real board answering) the "answering again" sentence with Update back; the same for Roll back. Red
  against the old page ("a press with no answer offered the button again at once").

## Weakest premise
That the board reports a stable `bootedAt` per process (the same field the update overlay's verdict already uses), so
"same boot" means it never went away.

## Not changed
- The server route and its idempotence.
- The relay path: the dialog asks /api/status through the same fetch the page uses, so it waits the same way when the
  board is reached through the relay ("Reconnecting...").

## Review 1 (2026-10-26) and what was done
- Reload also pressed Update (the new deadline Reload and the existing 409 Reload both fired the press listener):
  FIXED. The button is marked reload-only where it becomes Reload; the listener stands down on the mark; opening the
  dialog clears it. Browser check: a stubbed 409, then Reload, must not reach the route; red with the guard removed
  ("1 extra POST").
- Two waits, or a Roll back wait writing onto an Update dialog, after close and reopen: FIXED with a generation counter
  bumped by open and close, checked before and after each status read.
- 'restarted' with the version from before unknown: FIXED, it now needs it (a new boot may be the new version).
- The restart screen covers the dialog while the board is down: DECIDED, documented rather than changed. That screen
  is already the signal while the board is down and works end to end; this wait settles the dialog underneath for when
  it lifts. Would change my mind: a report of the dialog showing something wrong once the screen lifts.
- NITs: the #6903 comment no longer describes the no-answer case (fixed); focus moves to Cancel while the button is
  off and back after (fixed). Not done: the wait ignores `updateAttempt` (the installer's own failure record). The
  "answering" sentence already sends the person to press again, and the press reports that record through the
  existing overlay, so reading it here would duplicate that path.

## Review 2 (2026-10-26)
FIXED: the press took its dialog generation only once the wait began, after a POST that can hang; a dialog closed and
reopened meanwhile was written into. The press now takes it, and focus, before the POST. Wording: "Press Update to
try again. If the update already started, this joins it."

## Review 3 (2026-10-26)
FIXED: a stale press that came back REFUSED (a 409) still wrote into the reopened dialog; both no-answer and refused
now stand down. A stale SUCCESS still raises the overlay on purpose (the update really started; a second press joins
it). The browser check now drives "restarted" and the deadline through the wait's own status read (statusFetchWithin
swapped for those legs and put back) and presses the deadline's Reload asserting no POST; red with the mark removed.
Focus returns to the button only if it is still on Cancel.

## Review 4 (2026-10-26)
FIXED: the version and boot from before were read when the wait began, after the POST; the page's own poll could
already have seen the updated board, turning "done" into "press Update again". The press now takes them before its
POST and the wait never reads the live values (pinned by a test that the wait does not mention them). The browser
leg's clock skew is restored in a finally, and the boot id it seeds is put back.
Accepted, not changed:
- A 401 (signed out after a restart) from /api/status counts as no answer, so after three minutes the dialog says
  "has not answered" and offers Reload. The offered act is right; only the wording is loose, and the board's own
  signed-out handling shows on reload.
- With focus on Cancel during the POST, a doubled Enter closes the dialog. A success still raises the overlay, so
  nothing is lost.
- The Reload legs swap the navigation for a marker (location.reload cannot be stubbed); what they prove is that the
  click does not reach the update route.

## Review 5 (2026-10-26): converged, nits only, accepted
- pressNoAnswer reads "Waiting..." just after the error line shows; the wait's first status read is 2 s later, so a
  very slow machine could read after it. Accepted: the page sets the text and the disabled state in the same task as
  the error line, and the read is milliseconds later. If it ever flakes, read the state inside the same waitForFunction.
- The wiring tests are text matches; the behaviour is covered by the browser check and the verdict by the pure tests.
