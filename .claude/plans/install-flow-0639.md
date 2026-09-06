# Plan: 0.6.39 install-flow fixes (#9/#10/#11/#12)

**Spec of record:** `~/work/Josh-Brain/Projects/kosmos-0.6.39-install-flow-fix-specs-2026-09-06.md`
(Mona Lisa, design lead) + `kosmos-0.6.39-install-flow-test-feedback-2026-09-06.md` (Splinter, from
Josh's fresh-account 0.6.39 install test). Launch-gating: 0.6.39 prod-promote is HELD until these
land; Baron cuts 0.6.40 once all launch fixes are in.

## What finished looks like
The four install-wizard screens Josh flagged are corrected to Mona's spec, all guards green, and the
success screen no longer duplicates. My items only (Renet owns #1/#2/#4/#5; Kitty #3/#7).

## Items
- **#11 Screen 6 (Self improving):** headline -> "Help make Kosmos better"; the feedback switch label
  -> "Send daily diagnostic information, bug reports, and improvement recommendations."; the SECOND
  switch ("Let Kosmos know when you create an agent") removed and its fr-s6-createping /
  frRefreshPing / frPingToggle wiring unwired. The create-agent-ping feature + its /api/ping-setting
  backend are unchanged (its control lives on the Create-an-Agent screen, #2020).
- **#10 Screen 4 (Notifications):** cog 30->38px (reads as a gear not a bullet); box 340->460px
  (wider + shorter, body ~2 lines); "App Background Activity" bold (already 700). Copy unchanged.
- **#9 Screen 3 (Automation):** step text + vertical rhythm brought down, S3-scoped (#fr-pane-3).
  Shared eyebrow/headline/intro untouched (S4 shares them, Josh liked S4). Size/spacing only; Mona
  confirms the exact scale on review (the first-run overlay does not render cleanly headless).
- **#12 Screen 7 (Success):** replaced with Josh's VERBATIM copy (SUCCESS / "Kosmos is installed and
  configured." / applications-folder+dock body / drag-to-far-left line); the gold-K placeholder
  swapped for the real fc-k app-icon PNG; both "Show me where it is" buttons + the Applications-folder
  checkbox + all duplicated text removed, which meant removing the whole reveal subsystem
  (frPaintReturn / frRevealSay / #fr-return / the step-7 call). Shared symbols (frCheckRow,
  appLocation, /api/machine, /api/reveal-app for the Settings reveal) were kept.

## Scope decisions / weakest premises
- **#12 removed the #2086 platform-copy cluster** (frIsMac/frFindAppHint/frApplyPlatformCopy). It
  only served the now-deleted keep line and would rewrite Josh's verbatim macOS copy off-macOS,
  contradicting "shows EXACTLY". Consequence: the success screen shows the verbatim macOS wording on
  ALL platforms; non-Mac keep-line variation is dropped. Reversible; flagged to Mona for a ruling on
  whether non-Mac needs its own success copy. The install flow's other screens are macOS-specific
  (System Settings, Login Items, dock), so the flow is macOS-primary in practice.
- **#9 scale** is a conservative reduction pending Mona's review confirmation (could not render the
  overlay headless).

## Merge note
The branch base predates #2340 (Connect Claude), so its own suite is green (no connect-confirm red).
Merging current main in for the PR will pick up #2340 (+ Renet's connect-confirm test-fix once it
lands) and may need a web/index.html conflict resolution.
