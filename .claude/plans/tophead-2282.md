# Plan: one full-width top header across every view (#2282)

## Context
Josh's 0.6.36 ask (via Splinter): "have the header that I designed go across the top so we
can still have selecting which Kosmos you're in on the left and the tab-versus-consolidated
view, light/dark, and all that stuff over on the right, so that it matches the grid view."
Mona (design owner) merged the mock: chaoskosmos-site `design/top-header.html` (PR #101,
served at /design/top-header). This is the integration half (Angel's lane), built to that mock.

## What the mock decided (design/top-header.html)
- Header grid `1fr auto 1fr`: LEFT = K mark + Kosmos switcher; CENTER = tabs; RIGHT = view
  toggle + light/dark. Present on every view.
- The real change: on the CONSOLIDATED (and grid) views the appearance + view controls come
  OUT of the side rail back into the top-right header, so the top bar reads the same on every
  view. The rail keeps only what is per-view.
- Consolidated proposed header is 2-column (left + right, NO center tabs -- one screen).
- Narrow screens keep the controls in the header (toggle can icon-shrink); nothing drops to a rail.

## What "done" looks like
- Tab + grid views: unchanged (they already show the full 3-column header; grid is a tab-view list style).
- Consolidated view: the top header stays as a real full-width bar (K mark + switcher left;
  appearance `.themepick` + view-toggle `.laypick` right); center `.tabs` hidden; the side rail's
  own `.railme-theme`/`.railme-lay` copies hidden (folded up into the header); the rail keeps its
  per-view person -> Settings (`.railme-go`).

## Approach (web/index.html, CSS scoped to `html[data-layout="consolidated"] body.consolidated`)
1. Replace the consolidated header COLLAPSE (which hid `.klink`/`h1`/`.tabs`/`.worldsw`/`.headright`
   and zeroed the header) with a real top-bar rule: `.apphead > header` becomes a flex bar
   (space-between, padding, border-bottom, `--k-bg`), keeping `.headleft` + `.headright` visible and
   hiding only `h1` + `.tabs`.
2. Hide the rail duplicates: `.railme-theme`/`.railme-lay` -> `display:none` in consolidated (was
   `flex:none`, i.e. visible). Markup kept so the one document-level theme/layout handler stays in sync.

## Reconciliations / decisions (decide-and-document; not held on Josh)
- **#1303** (Josh, twice: "no gray emptiness band across the top" of consolidated): that objection was
  to an EMPTY collapsed-header band. This puts a REAL content header there (Mona's design-owner call,
  Josh's newer ask), flush to the top with no empty margin -- not the empty band #1303 hated. Documented
  in the CSS comment; flagged to Splinter.
- **Right-cluster ORDER**: the mock RENDERS view-toggle then light/dark, but Josh's explicit #2194 ruling
  (2026-09-04) put the view-toggle FAR RIGHT (past light/dark), and Mona's own decision table says "same
  order as today's header." So the mock's rendered order looks incidental; I preserved Josh's #2194 order
  (light/dark, then view-toggle far-right). One-line flip if Josh wants the mock's literal order. Weakest
  premise: that Mona's prose ("same order as today") outweighs her mock's rendered order -- documented so
  it can be flipped.
- **#checked account stamp** is in `.headright`, so it now shows in consolidated too (it shows in tab view
  already). Minor; noted for the headed pass -- can be hidden in consolidated if it reads cluttered.

## Verification
- New HERMETIC render check `docs/browser-checks/render-tophead-consolidated-2282.js`: reads computed
  display in tab (control) + consolidated states; asserts the header + right controls stay in consolidated,
  tabs hidden, rail copies gone, person->Settings kept. Run GREEN headless via the pinned runtime, and
  PERTURB-VERIFIED red-capable (4 fails against origin/main's pre-change web/index.html).
- Wired: browser-checks.sh hermetic loop, README row, reason-grep counts 52->53 / 30->31 (coupled tests
  green: reason-grep, indexed, wired #1387; browser-checks.sh `bash -n` clean).
- **Visual-fidelity limit (honest):** verified STRUCTURALLY (computed display) headlessly, not pixel
  layout. A headed visual pass should confirm the consolidated top bar + grid 100vh row math read right
  before this ships in a cut. Not in 6.38 (already served); this is for a future cut, so there is time.

## Weakest premise
That un-collapsing the header into the consolidated grid's auto-row run does not disturb the carefully
tuned 100vh / 38-row layout in a way structural checks miss. The header is an auto-height full-width top
row and the content row is `minmax(200px,1fr)` (flexes), so the math should absorb it -- but this is the
part most wanting a headed eyeball.

## Challenge-loop iteration 1 resolutions
- **W1 (stale comments in the edited region)** FIXED: the "everything inside .apphead is
  display:none / header 4px tall with every child hidden" comments were true of the OLD
  collapsed header and false now; rewritten as history with a #2282 pointer, and the
  margin:0-keeps-the-band-away reasoning marked as still-valid.
- **W2 (notice slots grow/misalign the flex header when a notice shows)** FIXED: removed the
  consolidated-only notice-slot `margin-bottom` rules. They were for the old collapsed-header
  design; the header now has its own border-bottom and the notices ride inside it as in tab
  view (consistent). A shown notice no longer grows the flex row. (Structural check has no
  notice fixture, so this was review-only-catchable; noted for the headed pass to confirm the
  notice reads right inline in the bar.)
- **W3 (#checked "last refreshed" stamp now shows in the consolidated right cluster; not in
  Mona's schematic mock)** DECIDED-KEEP: it shows in the tab/grid header too, and Josh's stated
  goal is "matches the grid view" (consistency across views), so keeping it is MORE faithful to
  the goal than matching the mock's schematic omission. Headed pass can hide it if it clutters.
- **NIT1 (dead fold-a rule for .railme-theme/.railme-lay)** FIXED: trimmed (they are hidden in
  all consolidated now); the fold-a rule folds only the name (.railme-b).
- **NIT2 (.worldsw dropdown menu could be clipped by the consolidated `overflow-x:hidden`)**
  HEADED-PASS ITEM: low risk, only multi-world installs; confirm the switcher menu is not clipped
  in the headed pass.

## Headed-visual-pass checklist (before this ships in a cut; it is NOT in 6.38)
- The consolidated top bar reads right (left cluster + right cluster; grid 100vh row math OK).
- A shown update/offline notice reads right inside the bar (W2).
- #checked stamp placement in the consolidated right cluster (W3) -- keep or hide.
- .worldsw dropdown menu is not clipped (NIT2).
