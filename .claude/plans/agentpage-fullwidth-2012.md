# #2012: full-width agent page

**Branch:** `agentpage-fullwidth-2012` · **Card:** kosmos#2012

Josh: the agent conversation area is "a small box in a mostly-empty window" — make the agent page
full-width with a persistent header and a large dialogue area. Mona Lisa's design spec
(`Josh-Brain/Projects/kosmos-agent-page-fullwidth-2012-design-spec.md`) diagnosed it as a
**design-vs-built gap**: the approved mock already specifies a full-width `176px minmax(0,1fr)`
grid, but the build capped `#panel-detail .dbody` at a fixed `34rem` (~544px) and `#d-window` at
`560px`. Those two caps are Josh's "neither axis expands."

## The decision that this reverses (recorded, because it is a reversal)

On **2026-08-25** Josh asked for the agent page to MATCH the settings width (34rem, centered), and
`#panel-detail` was threaded through Settings' capped rule. **#2012 reverses that for the agent page
only:** the agent page goes full-width; Settings keeps its 34rem reading column. The build splits
the previously-grouped rule so the two pages diverge.

## What this branch ships (the high-confidence, structurally-verifiable core)

All scoped to `#panel-detail` (the agent page); Settings untouched.

- **Full-width grid:** split `#panel-settings .dbody, #panel-detail .dbody { 176px 34rem }` into
  `#panel-settings .dbody { 176px 34rem }` (kept) and `#panel-detail .dbody { 176px minmax(0,1fr);
  stretch }` (full-width, falling back to the base rule's shape). The 60rem/56rem media rules still
  group both (relax to fluid, then stack) — a harmless no-op for the already-fluid agent page.
- **Full-width header:** `#panel-detail .dhead` goes `max-width: none` so the header spans the full
  width, matching the full-width body (capping it while the body widened would recreate the
  header/body width disagreement in reverse).
- **Dialogue fills the page:** `#d-window` max-height `560px` → `calc(100vh - 220px)` (viewport-
  relative, its own scroll via `.pj-screen { overflow:auto }`). Still a CAP, not a height, so a
  quiet agent draws a short box exactly as before; the 220px offset is a single tunable number.
- **Prose keeps a measure:** `#panel-detail .msg-b { max-width: 66ch }` so message text stays
  readable in the wide column (the mock's full-width principle: chrome spans, prose keeps a
  measure). The dialogue grows TALLER and gives the measure room, not longer lines.

**Tests updated to the new spec** (they encoded the old caps): `web.settings-width.test.js` (the
split + the full-width header), `web.agent-nav.test.js` (`#d-window` viewport-relative).
**New committed headless check** `docs/browser-checks/render-agentpage-fullwidth-2012.js`, wired
into `tools/browser-checks.sh`, asserts the four deltas against the OLD caps as controls (content
column far past 544, header max-width none, `#d-window` past 560, a finite ~66ch measure) — proven
5/5 green on this branch and 4/4 RED against `origin/main`'s pre-#2012 page.

## Deliberately deferred (documented follow-up, on the card)

- **The sticky "persistent header banner" behavior** (region 1 of the spec) and **pinning the
  composer** (delta 5). The header full-width lands here; making it `position: sticky` requires
  coordinating `.snav`'s existing `sticky top:16px` so the nav "pins under the header" (the spec's
  words) without overlap — a fragile interaction I cannot verify without interactive visual review.
  Landing it blind risks an overlap bug invisible to a headless geometry check.
- **Enriching the header contents** with state/because-line/model/account (the spec wants them in
  the banner; the build's `.dhead` currently carries avatar+name). That is a DOM move, also better
  with interactive verification.

The card stays OPEN for those refinements. This branch delivers "true full width" and Mona Lisa's
"big win" (the vertical fill), which is the substance of Josh's ask, at low risk.

## Weakest premise

That the sticky header + composer pin are safely deferrable rather than part of "done." Mitigation:
the full-width header is delivered (identity is visible and spans the page); only its *sticky*
behavior is deferred, and the deferral reason is a real verification limit, not convenience. What
would change the plan: Josh wanting the sticky banner in one PR (then it needs an interactive
browser pass, `needs-browser`), or the 220px `#d-window` offset proving wrong in-app (a one-number
tune).
