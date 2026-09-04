# @ picker refreshes on agent rename (kosmos#2139)

Branch: `mention-refresh-2139`. Owner: Mona Lisa (night shift, 2026-09-04). Card #2139,
"next free web builder". web/index.html + one node test.

## Goal / done-condition

The @mention autocomplete picker in the project-room composer shows an agent's CURRENT name
after the agent is renamed, not the stale old one.

## Root cause

The picker candidates come from `mentionCandidates(pjById(PJ_CURRENT))`, which reads
`PROJECTS[].agents[].name`. `PROJECTS` is repopulated only by `loadProjects()` (which reads
`/api/projects`, joining project membership to the fleet cards for each member's displayName).
The agent-detail Save handler (`#d-save` click) refreshed the fleet via `tick()` (which updates
`LAST`, a different structure) but never `PROJECTS`, so a rename left `PROJECTS[].agents[].name`
stale until the next projects load, and the picker read the old name.

## What I changed

- `web/index.html`, in the `#d-save` success path: after the heading update and before
  `await tick()`, `if (renameTo && renameTo !== wasCalled) loadProjects();`. Non-blocking (not
  awaited); `loadProjects()` self-catches its own read errors and never navigates away (its
  auto-open side effects are behind one-time flags already set before any Save is possible), so it
  never delays or breaks the save feedback. The picker reads `PROJECTS` live on the next keystroke,
  so an async refresh is enough.
- `web.mention-rename-refresh-2139.test.js`: a static source-pin (the About-you-gate pattern, since
  the live picker drive is not in `node --test`) that bounds the `#d-save` handler to its own
  column-0 `});` close and asserts a `loadProjects();` call on the name-change path. Verified RED
  with the fix removed. A control pins that `mentionCandidates` reads `a.name`, tying a `PROJECTS`
  refresh to the picker.

## Key decisions

- Refresh via `loadProjects()` (re-fetch the authoritative `/api/projects`) rather than mutating
  `PROJECTS[].agents[].name` in place. Rejected in-place update: it would duplicate the server's
  membership/naming join client-side, against this codebase's "no second copy of a rule" principle,
  for no real gain (the re-fetch is cheap and non-blocking).
- Guard on `renameTo !== wasCalled` (the shown name changed), not the server's `ren.changed`.
  `ren.changed` is the instruction-FILE rename verdict; the picker reads the displayName, which is
  persisted on any 200, so `renameTo` is the correct signal. `loadProjects()` is only reached after
  a 200 (a non-ok rename throws earlier), so the guard fires exactly when the picker's shown name
  will have changed. Matches the sibling heading-update pattern (index.html:22926).
- Weakest premise: that `loadProjects()`'s auto-open flags are always already set by the time a
  Save is possible. They are (the first poll sets them before the detail panel can be opened), and
  even if not, re-opening the current project is idempotent.

## Verification

- New pin passes; proven RED with the fix removed.
- Existing `web.mention-picker.test.js` (picker render) still green.
- Full run-tests.sh green (one mid-loop red was confirmed concurrent-cut contention, green alone).
- Browser-check: a full render drive needs a renamable, named, fleeted agent that is a member of a
  project `/api/projects` serves (a thread-server-class fixture), disproportionate for a one-line
  refresh; the wiring is pinned in source and the picker render is covered by the existing test.
  Commit carries the `Browser-check:` trailer the #1720 gate accepts.
