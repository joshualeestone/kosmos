# winscrollbars-3443 - Thin, theme-aware scrollbars on Windows only

## Card
kosmos#3443 (Josh, Windows QA 2026-09-22, raised several times): on Windows the scrollable panes
(agent nav/avatar column, conversation pane, project Members/Files/Tasks) render the default wide
light-gray Windows webview scrollbar, which clashes with the dark UI. Wanted, in priority order:
(1) ideal: no visible/overlay auto-hiding like macOS; (2) minimum acceptable: thin, dark-themed.
Remedy is shared-app CSS. Windows build/verify goes to the Windows box; I own the shared CSS side.

## Done-condition
On Windows, scrollable panes show a thin, theme-aware scrollbar (not the wide light-gray default);
macOS keeps its native overlay scrollbars unchanged.

## The call (reversible, so mine per the night-shift rule)
- WINDOWS-SCOPED, not global. The app already stamps `html[data-kosmos-platform="win32"]` on
  Windows only (applyPlatformCopy; used at web/index.html:7483 for [data-win-hide]). Scoping the
  scrollbar CSS to that selector fixes Windows and leaves macOS's overlay scrollbars completely
  untouched. Applying it globally would replace macOS overlay scrollbars app-wide, which Josh did
  not ask for.
- THIN + THEME-AWARE (the card's "minimum acceptable"), because true auto-hide overlay is not a
  pure-CSS affordance on the Windows webview. Colors are the existing theme tokens (--k-rule thumb,
  --k-ink-2 on hover) so the bar tracks light/dark on its own.
- ::-webkit-scrollbar pseudo-elements, NOT `scrollbar-width`. On newer Chromium setting
  scrollbar-width disables the ::-webkit-scrollbar rules, so the pseudo-element form alone is the
  version-safe path for the Electron webview.

## Verification
- render-win32-board-copy.js (the surface-gate covering check for data-kosmos-platform) gains a
  measured arm: a scrollable element's (offsetWidth - clientWidth) is the scrollbar's layout width.
  Under win32 it is exactly 10px (the explicit rule forces a custom bar at 10 in any Chromium).
  Unstamped, the width is the runner's native default (0 for a macOS overlay, ~15 for a classic bar
  on a Linux CI runner), so the control asserts only that it DIFFERS from 10, never a fixed number -
  else it would false-red on CI. It launches its own chromium with --hide-scrollbars OFF, or every
  arm would read 0 vacuously.
- Positive control: setting the rule's width to 0 reds the win32 arm; 10px passes.
- All 88 assertions in that check pass (existing board-copy behavior unaffected).
- The actual Windows appearance is verified on the Windows box (per the card's split); this change
  is verifiable on my side only for the win32 SCOPING and the layout width, which is what it asserts.

## Rejected
- Global scrollbar CSS (no platform scope): regresses macOS overlay scrollbars app-wide, which the
  card did not ask for and I cannot verify improves Windows without the Windows box.
- Hiding scrollbars entirely (width:0): removes the grab affordance; the card's ideal is auto-hide
  overlay (not pure-CSS achievable), so the thin-themed minimum is the robust choice.

## Weakest premise
That Josh is fine keeping macOS's overlay scrollbars (I changed only Windows). The card is a Windows
report and says the remedy is shared CSS "so one fix covers it"; I read that as the fix living in
shared CSS, scoped to where the problem is, not as a request to restyle macOS too. If he wants the
thin bar on macOS as well, dropping the `[data-kosmos-platform="win32"]` scope does it in one line.
