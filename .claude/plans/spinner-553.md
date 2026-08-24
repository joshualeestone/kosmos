# The update spinner can say it failed (#553)

## What finished looks like

Pressing Install on an update that cannot succeed tells the person
something TRUE within a bounded time, in the overlay, without a refresh:
- the installer child stopped with an error: "The update did not take
  (the installer stopped, code N). Kosmos is still on X. The installer's
  own notes are at <install.log>." with Try again / Reload;
- the board never went away and still answers the old version past
  ninety seconds: "This is taking longer than expected. Kosmos is still
  on X..." with where to look, and at the three-minute deadline the same
  sentence plus Reload, never a blind reload into a toast that says
  update available;
- the board went away and came back on the OLD version: "did not take";
- the board went away and came back changed: reload into the finish
  line, as today.
"It failed" is said only when the installer's own exit says so; a slow
swap is "taking longer", because the honest words matter more than the
mechanism (the card's rule).

## Why

/api/update answers 200 before anything happens, by design (finishing
the job kills the server), so the spinner's only success signal is the
server dying and returning changed, and there is no failure signal at
all. Josh watched three minutes this morning and learned nothing; his
refresh discarded the one piece of state that knew anything.

## Changes

- engine/update.js: wireChild already sees a non-zero exit while this
  server lives (a failed install never kills it); it now RECORDS the
  attempt (startedAt, endedAt, exit code, the version it was for) as
  lastAttempt(), cleared at the next beginInstall; spawn errors record
  the same shape.
- server.js status payload: updateAttempt: updates.lastAttempt(), beside
  update/updateLook.
- web overlay: the poll reads updateAttempt; a pure verdict function
  (slice-testable) maps {sawDown, versionNow, before, attempt, elapsed}
  to one of: keep waiting, failed, slow, did-not-take, done. The overlay
  text follows the verdict; failure and deadline states get Try again
  and Reload instead of an automatic reload. The install.log path comes
  from the engine (installedRoot() + logs/install.log), never guessed by
  the page.

## Review bound (stated before the loop)

Up to two rounds. Properties: no sentence claims failure without the
installer's own non-zero exit; no state stays a spinner past the
deadline; the pure verdict is pinned for every branch; the payload field
cannot lie about an attempt that is not this one (an old failure must
not fail a new press). Fix-with-a-pin for violations; carding for the
rest.
