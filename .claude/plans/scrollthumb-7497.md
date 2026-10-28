# #7497: a grabbable scrollbar thumb on long panes (Windows)

**Posture:** production

## Problem
#3539 (#3443) gave Windows a thin themed scrollbar, but no floor on the thumb's length. On a long
conversation the thumb shrinks to about 10px. Measured in the real Windows app (WebView2, 0.7.72) on
a 46,321px thread in a 599px pane: 17 lit rows in the scrollbar column, about 10px of visible thumb.

## Change
Two rules in web/index.html, scoped to `html[data-kosmos-platform="win32"]` like the rest of the
#3443 block, so macOS (overlay scrollbars) is untouched:
- `::-webkit-scrollbar-thumb:vertical { min-height: 40px; }`
- `::-webkit-scrollbar-thumb:horizontal { min-width: 40px; }`
The bar stays 10px wide. The `:vertical` / `:horizontal` split keeps the floor on the axis the thumb
travels along, so a horizontal bar's thumb is not forced to 40px tall.

## Measured on the Windows box (real Kosmos window, WebView2, over its debug port)
- The same thread with the exact rules injected: 17 lit rows before, 40 after (dark theme).
- The browser check's own probe, run in that WebView2: 36 thumb rows with the floor, 13 with it
  overridden to 0 (light theme, 600px pane over 46,000px).

## Test
docs/browser-checks/render-win32-board-copy.js (on CI's fixed allowlist, so it runs on every PR)
gains a pixel arm: a 600px win32 pane over 46,000px, a 1px-wide screenshot down the middle of the
10px bar, rows that differ from the track counted. Asserts >= 30 with the floor. CONTROL: with the
floor overridden to 0 the same thumb is under 20, so the arm can fail. No DOM API reports a thumb's
size, so the compositor is read directly. The decoder handles PNG row filters for a 1px-wide image.

## Rejected
- `scrollbar-width` / `scrollbar-color`: the #3443 block notes newer Chromium then ignores the
  ::-webkit-scrollbar rules, which is what gives the 10px bar.
- A bigger floor (60px+): it would hide position on medium threads. 40px is about a fingertip and a
  comfortable mouse target, and on a pane under 80px it still leaves room to move.

## Weakest point
The browser check reads pixels on CI's headless Chromium (Linux), which I could not run here (no real
Playwright on this box). The probe and decoder were proven in WebView2 instead. If CI's renderer
draws the thumb differently (anti-aliasing, a different track), the thresholds (30 / 20) have room.

## What would change my mind
A person finding 40px too long on short panes, or CI's renderer showing thumb rows outside 30..45
with the floor.

- Round 0 (build)
