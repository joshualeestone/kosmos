# Plan: in-browser first-ring regression guard for #4499 (#6196)

## Problem
#4499 fixed the org chart so a first-ring (root) hub line never passes nearer than 12px
(`ORG_LINE_CLEAR`) to any face, via `orgPlaceGated` (a measured first-ring floor). No browser-check
exercised that clustering path: the sibling `render-org-lanes-4472` drives a first ring of one root
(its three managers sit on the second ring), so it never clusters. #6196 adds the missing guard.

## Approach
New driver `docs/browser-checks/render-org-first-ring-6196.js`, wired into `tools/browser-checks.sh`
(a new `ORG_WIDE_TREE` board and a port-picker bump 20 to 21 with a new P20), plus a README row.

The board is one HEAVY root (`r0`, 100 reports) and nineteen light roots: the heavy root hogs the
angular slice, so the light roots cram into near-equal slices, bump to outer lanes, and graze. An
even-root board does NOT cluster (it cleared 52px pre- and post-fix, i.e. vacuous), which is why the
asymmetric shape was chosen.

The driver settles the chart, finds the first ring from the wires (a root's wire starts at the hub
centre), and asserts every first-ring hub line clears every other face by the 12px rule AS DRAWN.
"As drawn": orgFit squeezes the chart by a radius scale k in [ORG_SQUEEZE_MIN=0.7, 1], so the
threshold is per-width, `max(CLEAR_FLOOR=8.4, ORG_LINE_CLEAR * min(1, k))`. Per Liu Kang (m5697), k
is read from the DRAWN artifact (not a recompute of orgFit): for >=3 rendered faces with placement
radius >= 40px, k = (the face's rendered distance from the hub) / (its own placement radius), and
the readings must agree within 1% or drawnK returns NaN and the check fails loud.

Non-vacuity in-check: a segDist control pair, came-to-rest, every agent has a visible wire
(faces == wires), at least a dozen first-ring roots found, and the k-plausibility gate. A missing
element, an empty selector, a failed boot, or an unreadable k all fail RED, never a silent pass.

## Files
- `docs/browser-checks/render-org-first-ring-6196.js` (new driver)
- `tools/browser-checks.sh` (ORG_WIDE_TREE board, port-picker 20 to 21 / P20)
- `docs/browser-checks/README.md` (driver row)

## Verification (RED / GREEN on the FINAL driver, 85ca0b29, both widths, post-settle)
- RED, final driver + a pre-#4499 page (detached fixture): desktop k=0.786, threshold 9.4px, FAIL
  with `least 4.9px (r2 past r19)`; phone identical; the segDist control, came-to-rest, 120
  faces/wires, the 20-roots non-vacuity gate, and the k-read gate all PASS; reproduced on the
  flaky-retry (same 4.9px).
- GREEN, final driver + the fixed page: desktop k=0.742, threshold 8.9px, PASS with `least 13.3px`;
  phone identical.
- Node-suite validation (challenge-loop 6j) recorded a clean pass on the head.

Note for the next reader: the driver comment's ~6.3px is a PLACEMENT figure in natural space; the
check prints the DRAWN clearance, which is 6.3 natural times k (about 4.9px at k=0.786 on the RED
page). The GREEN k (0.742) is LOWER than the RED k (0.786) because the fix pushes roots outward, so
the chart squeezes more, yet the drawn clearance rises (18 natural times 0.742 = 13.3px drawn),
which is exactly the fix working.
