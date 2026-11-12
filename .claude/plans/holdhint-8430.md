# holdhint-8430: the task-holdforyou-7788 design shot checks the task page's current hint

Card: joshualeestone/kosmos#8430 (found while shooting #8395, carded by Mona Lisa). Off main.

## Finished looks like

`task-holdforyou-7788` shoots without throwing on main, its check still fails if the task page's hint loses the
"waits on you" wording, and the list and card arms (`tasks-holdforyou-7788`, `project-holdforyou-7797`) keep
checking "until you answer" as before.

## Decided

The shared `holdForYou7788` verify read three elements with one regex, `/until you answer/`. The list
(`.tsk-for-you`) and card (`.tkcard-for-you`) still say that; the task page's `#tk-hold-hint` now says "An agent put
this on hold because it waits on you..." (web/index.html). The task-page arm now checks `/waits on you/`; the other
arms are unchanged.

Rejected: one looser regex for all three (`/until you answer|waits on you/`), because a list or card that lost its
wording would then pass on the other phrase.

Weakest premise: "waits on you" is the phrase that carries the meaning on the task page; if the hint is reworded
again, this screen breaks again, which is the point (it fails loudly rather than shooting a wrong screen).

## Change

- docs/browser-checks/mobile-shots.js: the verify regex per arm.

## Results

- Shot run, all three screens, desktop and iPhone 15, light and dark, Chromium: 12 shots, 0 errors, 0 overflow
  (~/work/design-shots/kosmos-8430/). The project phone shot's 11 small taps are that page's existing controls.
- Negative control: with the hint's "waits on you" changed to "needs you" in web/index.html (not committed), the
  task-page shot fails its check, naming the line. Restored; the tree is clean.
