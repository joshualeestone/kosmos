# fix-2389-adopt-disk-scan

Card: joshualeestone/kosmos#2389 (filed by Renet, verified live on origin/main e13d6e4f).

## Problem
`frPaintFleet()` in `web/index.html` decides the first-run "your agents" screen from
`path` (`adopt` = tmux sees >=1 running agent, `create` = zero, `unknown` = tmux
unreadable). The disk scan that finds agent folders Claude has NO record of
(`frScanAgents` -> `frScanOffer`/`frImportOffer` -> `frPaintScan`, #1938/#1652) runs in
the `create` and `unknown` arms but NOT the `adopt` arm. So a person with a running
fleet who ALSO has agents in ~/Documents/Downloads whose folders are not in Claude's
records is shown the verbatim "There is nothing to import and nothing to wait for."
while it is false. That exact "SAID WHILE FALSE" case is named in the #1493 comment at
the top of the function and in web.found-every-path-1493.test.js's docstring, but the
adopt arm was the one arm the #1938 fix never reached.

## Fix
Mirror the create/unknown arms' scan chain into the adopt arm, keeping the "You already
have N agents here." heading (it is true and reassuring):
- `FR_SCAN === null` -> fire `frScanAgents()` and render a neutral in-flight line
  ("They are already here. Checking this computer for any others to add…") instead of
  the "nothing to import" sentence, so the false claim never sits on screen before the
  disk is read (same rule the create arm follows for its empty state).
- scan done -> `frArmRescanOnGrant()` (so a late file-access grant re-scans, the #4 fix,
  which the adopt arm also lacked), then if `frScanOffer()`/`frImportOffer()` has
  entries hand to `frPaintScan()` (one painter, no second copy of the Add/Skip rows).
- scan done + empty -> render Josh's verbatim pack copy unchanged.

## Decisions
- **Copy ruling respected (confirmed by Splinter 2026-09-07).** "There is nothing to
  import and nothing to wait for." is Josh's verbatim pack string (2026-08-17). The fix
  ADDS a branch and renders that string only when the scan confirms it is true; it does
  NOT edit the ruled sentence. The one new user-facing string is the transient scanning
  line, which is a claim about their machine that resolves to a definite state (not a
  report on our own uncertainty), consistent with the create arm's blessed "Reading what
  is on this computer." Josh can swap the transient wording; it is reversible.
- **Reused frPaintScan** rather than appending import rows to the adopt box, matching the
  create/unknown arms and avoiding a second surface for the Add/Skip handlers.
- **Browser-check gate (#1720):** satisfied by a `Browser-check:` trailer, not a
  docs/browser-checks change. Reason: the frPaintScan render it hands to is already
  browser-covered by render-scan-board.js; #2389 changes only which PATH reaches it,
  which is pure branch logic covered by node tests + perturbation in
  web.found-every-path-1493.test.js; the fleet cannot run browser checks (#1769).
  Follow-up for a browser session that has the box: extend render-adopt-1531.js with an
  adopt-path -> frPaintScan assertion so a wired regression is caught there too.

## Tests (web.found-every-path-1493.test.js, branch-level, perturbation-proven)
Added a `box` field to the harness return, then 5 assertions:
- adopt path fires the disk scan (SCAN-SEARCH), the #2389 gap.
- while scanning, the box does NOT assert "nothing to import"; heading kept.
- a folder candidate -> frPaintScan + frArmRescanOnGrant (the #4 re-scan, one arm over).
- loose importable FILES -> frPaintScan.
- CONTROL: running fleet + genuinely empty disk -> the verbatim pack copy still renders,
  proving the ruled string was not touched.
Perturbation: reverting web/index.html to origin/main reds 4 of the 5 (the control stays
green, correctly, because the empty path is unchanged). Restored: 15/15 pass.
