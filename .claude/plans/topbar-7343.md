# topbar-7343: the iPhone Agents screen from Josh's 10-27 batch, one PR

Cards: kosmos#7341 (avatar dot), #7342 (status pills), #7343 (one top bar). Stacked branches shipped as one PR:
avatardot-7341 -> pills-7342 -> topbar-7343. Designs: Mona Lisa's, on the cards. Shots:
~/work/design-shots/kosmos-7341-7343-built.

## Finished looks like

On the iPhone: the Agents list's avatar dot says only whether the agent is there (green running, grey stopped,
hollow when Kosmos cannot tell, the board's memberDotClass rule); the status shows as a small pill only when there is
something to see (green Working, blue question or permission, amber held, red real problem, grey unknown, none for
Idle), with the Mac's own words; Agents, Projects and Tasks share one bar (Kosmos mark, computer switcher, then order
or filter and + in one capsule), no big titles; Tasks group headers are semibold 15 pt with a count capsule.

## Steps (built, see commits)

1. BoardLogic: presence and pill mapping as pure functions, parity with the board's CARD_ST (logic test reads it,
   control proven).
2. AgentsView: dot and pill; order menu.
3. TasksView, ProjectsView, SettingsView: the shared bar, headers.

## Decided

- The per-agent notification badge was split out to #7354.
- Sticky Tasks headers are not done: an insetGrouped List cannot pin; needs a ScrollView + LazyVStack(pinnedViews)
  rebuild. Left for a follow-up rather than rebuilding the list in this PR.

## Verify

LogicTests (run.sh), typecheck for the iOS 16 simulator, repo tests that read the app's Swift, shots light and dark.

## Review bound

Challenge loop, two rounds then PR; later findings become cards. Beta rule (Josh 08-19): merge on green.
