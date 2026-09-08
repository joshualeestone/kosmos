# #2497 - Onboarding: stop auto-importing agents; land on the no-agent Giddy Up screen

## Josh's decision (2026-09-08, watching Ben + Nacho test)
Remove the step that auto-scans/auto-imports existing agents during first-run. New users land on
the regular no-agent "Let's Get Started" / Giddy Up screen, as if the machine had no agents. Auto-
import on a dev box (many tmux Claude Code sessions) fills the board with garbage agents on first
launch. Manual Import Agent (#1652) from the Create Agent screen stays as the ONLY import entry.

Routed to Angel by Splinter/PigeonPete; single owner. 0.6.48->prod gate.

## Where the change lives (PigeonPete's scoping, verified)
`web/index.html` `frPaintFleet()` (~41226) is the first-run Screen 9 painter (every caller is
`FR_STEP > FR_STEP_YOU`-guarded). It has three arms - adopt ("You already have N agents here"),
create ("Create your first agent." / "Let's get started."), unknown - and each arm auto-fires the
discovery scan (`frScanAgents` -> `/api/scan-agents` or the granted `/api/scan-import`) and renders
a found/Add-Skip list (`frPaintScan`/`frPaintFound`) when candidates exist. The create arm's settled
empty state (41585) IS the Giddy Up screen. `frForkActions` (41630) builds the create-path "Giddy
Up" button -> `frFinish(openCreate)`.

`engine/firstrun.js fleet()` stays (the count is still honest); only the frontend routing changes.

## The change
1. At the TOP of `frPaintFleet`, before any `frFindAgents`/`frScanAgents`, force the no-agent
   create/Giddy Up screen and return, unconditional of path/fleetCount:
   ```
   title.textContent = 'Create your first agent.';
   box.innerHTML = '<p>Let’s get started.</p>';
   frActions({ label: 'Giddy Up', go: () => frFinish(openCreate) });
   return;
   ```
   (Explicit create action, NOT frForkActions, because frForkActions honors the real FR.path and
   would render "Take me to my agents" on an adopt machine; the card wants the create/Giddy Up
   button regardless.)
2. The three scan arms below become unreachable during onboarding. KEEP them (the discovery
   machinery, per the card's "do not delete the engine"), clearly commented as bypassed by #2497.
   The grant-flip poll never arms (frArmRescanOnGrant is only reached from the arms); the found-row
   Undo handler (41076) never fires (no found rows rendered).
3. Manual path untouched: Import Agent from Create Agent (#1652, openCreate -> pickMode('import') ->
   `/api/scan-import`) is a separate flow, not frPaintFleet. Verified independent.

## Tests
- `web.firstrun-panecount-9screen.test.js` (string-based): assert `frPaintFleet` forces the create/
  Giddy Up render (title 'Create your first agent.' + "Let's get started." + a Giddy Up action) and
  `return`s BEFORE any `frScanAgents(`/`frFindAgents(` call, and that the forced block is not gated
  on path/count - so first run lands on Giddy Up even with a non-empty roster and no auto-scan fires.
- Browser-verify (Playwright, done-check per Splinter): drive first-run to S9 on a machine that
  reports a non-empty fleet, confirm the screen shows "Let's get started"/Giddy Up (no found list)
  and that `/api/scan-agents` is never requested.

## Re-triage (card note)
#2452/#2453/#2455/#2461 were against the AUTO path on first run; once auto-import leaves onboarding
they move to the lower-traffic manual Import Agent path. Note on the card, do not fix here.

## Rigor
Live first-run wizard, merged into hourly today (#2488/#2490/#2492/#2493) - rebase before PR,
challenge-loop, browser-verify the landing.
