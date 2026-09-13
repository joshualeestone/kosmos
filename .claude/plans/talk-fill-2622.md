# Plan: #2622 part 2 — the Talk dialog box fills to the bottom of the window

Branch: talk-fill-2622. Repo: joshualeestone/kosmos. Author: Mona Lisa.

## Goal
Josh product review: on the agent "Talk to them" screen, "the dialog box should fill the bottom of the screen 100%, all the way down. Regardless of where the window's bottom edge is dragged, the dialog box should stay 100% tall and fill that space (right now it's a big empty gap)." Part 1 (search bar on the caption baseline) shipped in PR #2663; this is part 2.

## Why it is still live (not done by #2012)
#2012 (full-width agent page) fixed WIDTH and gave the Terminal window (`#d-window`) a tall height. The Talk thread box (`#d-talk-box` / `#d-dmthread`) was never given a fill-to-bottom height. Confirmed in source (web/index.html ~12508-12516 and the `.dmthread` rule ~4598). So this is the Talk-box analog of #2012, and closing it on #2012 would be a false-close.

## Mechanism
`#panel-detail` is a document-scroll panel (a `hidden`-toggled section, not in the consolidated 100vh grid), so the fill is a definite viewport `height` on the panel plus a flex chain down to the thread:
- `#panel-detail:has(#d-sec-talk:not([hidden]))` gets `display:flex; flex-direction:column; height: calc(100vh - var(--talk-fill-top, 152px))`.
- `.dbody` (flex:1, align-items:stretch) → `.dsecs` (flex column) → `#d-sec-talk` (flex:1) → `#d-talk-box` (flex column, flex:1) → `#d-dmthread` (flex:1, min-height:0, max-height:none).
- Two load-bearing facts, per the #980 project-room lesson (web/index.html ~3878): a bare `max-height` does not grow a short box, and a `min-height` lets content grow the panel unbounded so the thread never scrolls — a DEFINITE height is required. And `.dmthread`'s own `max-height:15rem` cap must be lifted or the thread stays short.
- `:has()`-gated to the Talk section only; Model / Memory / Terminal / etc. keep content height. `:has()` is already used ~25x in this file.
- Offset (152px) covers only chrome ABOVE the panel (sticky `.apphead` + body top padding) plus body bottom padding, and is agent-independent (the variable `.dhead` sits INSIDE the fill), so one fixed offset holds across window sizes. Measured panelTop=93 constant across heights.

## Verification
New headless browser-check `docs/browser-checks/render-talk-fill-2622.js`: measures `#d-talk-box` bottom vs the viewport bottom at two window heights (1100 and 700), asserts the thread scrolls internally on a long conversation, the composer pins near the bottom, and — scoping — a non-Talk section (Model) stays content-height. Fill arms are written to red on the pre-change page. Registered in tools/browser-checks.sh, docs/browser-checks/README.md, and the in-file surface decl.

## Scope / out of scope
- CSS-only change to web/index.html + the new check + registration. No JS, no markup change.
- Uses `100vh` to match the sibling `#d-window` rule; a `100dvh` follow-up for a mobile URL bar is noted on the card, not done here.
- Bottom breathing room is the app's standard 64px body bottom padding (offset 157 = panelTop ~93 + 64, so the box lands 64px above the window edge, not a void); reversible, Josh eyeballs in-app.
- KNOWN LIMITATION (follow-up): the 157px offset is fixed, but `.apphead` grows when a persistent update/offline notice wraps (most at narrow width). With a definite height the box then overshoots the window bottom by the notice's extra height (~8px wide, up to ~59px narrow), a small page scroll, bounded and no worse than the pre-change always-scroll. A robust fix would measure `.apphead` at runtime and set `--talk-fill-top`; deferred rather than adding a JS observer here.

## Also closes
kosmos#2711 item 7 ("dialog always fully visible at any window height") — same problem, same fix.
