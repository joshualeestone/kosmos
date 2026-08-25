# plus-status-poll-743

## What this branch is

#743: on the Plus settings screen, the status line ("Starting the
connection.") sat unresolved for minutes after the tunnel was already up,
because `paintPlus()` only ran on arrival and a few explicit gesture
triggers, never on a recurring poll -- unlike the device-ask list beside
it, which has its own 5s timer and updated live. Pete found the gap by
comparing the two.

## Scope

- `web/index.html`: the main status `tick()` (5s) now calls `paintPlus()`
  too, gated on the Plus section actually being the one on screen
  (`URL_TAB === 'settings' && SETTINGS_SEC === 'plus'`), so a hidden
  Plus section still costs nobody a fetch. `settingsGo`'s comment
  updated to describe arrival-paint-plus-tick-repaint rather than
  arrival-only.
- Review-driven: `paintPlus` gained `PLUS_EPOCH`, the same sequencing
  guard `INSTR_EPOCH` already gives the status poll, so a slow poll
  response cannot overwrite a faster user click (or vice versa)
  regardless of which fetch resolves first.
- `web.plus-tab.test.js`: a behavioural test for the poll-driven
  repaint (brace-matched extraction of `tick()`, with a CONTROL
  against the extraction overshooting into the next function), and a
  second behavioural test exercising the epoch guard directly (two
  calls dispatched in order, resolved in reverse order, asserting the
  later-dispatched call's state wins).

## Done when

- The Plus status line repaints while the section stays open, not only
  on arrival.
- A slower, earlier-dispatched poll cannot revert a faster, later
  user action.
- Unit suite green. Full `tools/browser-checks.sh` page-gate green.
