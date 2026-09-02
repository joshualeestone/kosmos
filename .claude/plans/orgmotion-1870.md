# #1870: rendered-DOM reduced-motion overlap arm for the org chart

## The ask

#1738 fixed the org chart overlapping under `prefers-reduced-motion` (the old
path skipped the relaxation and left a reduced-motion user with whatever the seed
gave, permanently overlapping if it was dense) and guarded it with a node test
(`org-reduced-motion-settle-1738.test.js`) that lifts the real `orgStep`, seeds an
overlapping field and asserts the synchronous settle resolves it.

#1870 asks for the rendered-DOM belt-and-suspenders: a `render-org-chart`-style
browser arm that drives the actual page under emulated reduced motion and asserts
no two discs overlap. It was split off #1738 because it could not be made to red
on main with the existing runner fixture. Dependency `orgreseed-1738` is now on
`origin/main` (HEAD `4535a323`), so the arm can be built to green and landed.

## Why a separate, dense board (the whole trap this card is about)

`render-org-chart` runs against `write_fleet_rich` = five FLAT agents, whose
static `orgPlace` is already 0 overlaps (Baron measured). A reduced-motion arm on
that fixture is GREEN on main, GREEN after the fix and GREEN on a revert: aimed at
the arm where the defect does not exist.

The arm needs a board whose STATIC `orgPlace` overlaps, so the settle is
load-bearing. `write_fleet_rich` cannot be reused or made denser:
`render-org-chart`'s fill-band assertion is keyed to node count (4 -> 59% pass,
6 -> 53% fail), so a denser shared board takes that check red. So this ships its
own board via `boot_board_org`.

The fixture: a manager (`boss`) with EIGHT direct reports (`c1`..`c8`), which
`orgPlace` packs into a ~69deg arc (`spread = PI/2.6`) at radius 194 so adjacent
disc centres sit ~33px apart, well inside their 44px diameter; plus two
second-level reports (`g1`,`g2` under `c1`) for depth. Eleven agents, all running
(a pane each) so they enter the roster; the tree is expressed by `reportsTo` in
each profile. Seeded in node, not bash (macOS bash 3.2 has no associative arrays).

## The property and the metric

Discs are 44px. Two discs overlap when centre distance < 44 (a real
intersection). The sim's `ORG_SIM.minGap` is 52, so a settled field clears the
diameter with margin. The check measures `.face` centres (not the `.onode`
button, whose box grows with the absolutely-positioned callout).

## Non-vacuity, guarded two ways

1. **Perturbation (measured; the card's "done when").** Reverting
   `orgLiveSettle()` to the pre-#1738 static path (`orgLiveSync()` in the
   reduced-motion branch of `orgLiveStart`) turns the check RED, while it is GREEN
   on main. Measured on the exact committed check + board:
   - main: exit 0, all four assertions pass, min centre distance 52px.
   - reverted: exit 1, `7 overlapping pairs (centres 33,33,34,33,34,33)`, tightest
     pair 33px. FAIL lines are gate-quotable (`FAIL  no two discs overlap ...`).
   - reverted, reduced-motion OFF (animation path): 0 overlaps — confirms the
     defect is specific to the reduced-motion branch.
2. **In-check density guard (so a future fixture flattening cannot make it
   vacuously pass).** The tightest pair must sit at the sim's floor
   (`minCenterDist <= 64`). Calibrated: the dense board settles to 52; a flat
   five-agent board leaves the tightest pair 114px apart and fails that arm. So a
   fixture too sparse to have overlapped statically reds here rather than passing
   for nothing.

The check also asserts >= 9 nodes drew, so a broken/empty board reds loudly
instead of passing with nothing to overlap.

## Files

- `docs/browser-checks/render-org-reduced-motion.js` — new check (self-contained
  playwright, `newContext({reducedMotion:'reduce'})`).
- `tools/browser-checks.sh` — `write_fleet_org` + `boot_board_org` (dense board),
  a new port `P16`, and the board group that runs the check.
- `docs/browser-checks/README.md` — names the new check (indexed test).
- `tools.browser-checks-wired.test.js` — `EXPECTED_BOOTS` 7 -> 8 (the new
  dry-run board), deliberately, as that test instructs.

## Guard tests run (all green)

- `browser-checks-indexed.test.js` (README names every script) — pass.
- `tools.browser-checks-wired.test.js` (every check is run; boot-count) — 8 pass.
- `browser-checks-selectors.test.js` (every id exists in the page) — pass; the
  check reuses only `#firstrun`/`#orgmap`, already used by `render-org-chart`.
- `browser-checks-reason-grep.test.js` (`EXPECTED_SITES=28`) — pass, unchanged:
  the `say()` ternary emit form is not a counted SHAPE (same as `render-org-chart`).
- `org-reduced-motion-settle-1738.test.js` — 3 pass (`web/index.html` untouched).

`web/index.html` is NOT modified: this card adds a check and its wiring, nothing
in the product.
