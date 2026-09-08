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
have N agents here." heading (it is true and reassuring). The adopt arm is now a
five-branch state machine (this final shape emerged over a 6-iteration challenge-loop; the
per-iteration refinements are in the commit messages):
1. `FR_FOUND === null` -> hold a neutral "checking" line, do NOT scan yet. Waits for the
   found search (fired at the top of frPaintFleet) to settle first, so the scan fires ONCE
   on the found-settle repaint rather than once now and again on that repaint (the
   double-`/api/scan-import`-walk / double-permission-prompt the create arm's comment
   documents). [iter 2]
2. `FR_SCAN === null` -> fire `frScanAgents()` and hold the "checking" line (not the
   "nothing to import" sentence, so the false claim never sits on screen before the disk is
   read).
3. `frArmRescanOnGrant()` (so a late file-access grant re-scans, the #4 fix the adopt arm
   also lacked), then if `frScanOffer()`/`frImportOffer()` has entries hand to
   `frPaintScan()` (one painter, no second copy of the Add/Skip rows).
4. `FR_SCAN_INFLIGHT` -> hold the "checking" line. A granted two-phase scan sets FR_SCAN to
   a `scanning:true` partial (no rows yet, TCC folders land last) and repaints while still
   running; without this the verbatim would flash over that partial. [iter 3]
5. Verbatim "nothing to import" ONLY on a clean, complete, readable-empty scan:
   `FR_SCAN.ok === true && scanning !== true && !bounded.tccUnavailable`. Three settled
   shapes are excluded because they are not a genuine empty answer: a retry-exhausted
   `scanning:true` result and a hard `{ok:false}` failure [iter 4], and a
   `bounded.tccUnavailable` result where the grant was given but Documents/Downloads/Desktop
   went unread [iter 5]. On any exclusion, fall to a silent else (heading + fork, box
   cleared, no import claim).

The transient "checking" copy is a shared local const across branches 1/2/4 so it cannot
drift. [iter 4]

## Decisions
- **Copy ruling respected (confirmed by Splinter 2026-09-07).** "There is nothing to
  import and nothing to wait for." is Josh's verbatim pack string (2026-08-17). The fix
  ADDS branches and renders that string only when the scan confirms it is true; it does
  NOT edit the ruled sentence (verified byte-for-byte vs origin/main every iteration). The
  one new user-facing string is the transient "checking" line, a claim about their machine
  that resolves to a definite state (not a report on our own uncertainty), consistent with
  the create arm's blessed "Reading what is on this computer." Josh can swap it; reversible.
- **Silent else on a failed/unfinished/tcc-blocked read**, not a confession. Matches Josh's
  standing S9-empty ruling (stay silent about what we could not read rather than confess
  it) and frPaintScan's own disclose-only-when-rows behavior.
- **KEPT + FLAGGED for Josh (reversible):** the ungranted bare-route empty still renders the
  verbatim. The bare `/api/scan-agents` is TCC-free by design (#2125, no permission ambush)
  and skips Documents/Downloads/Desktop, so pre-grant "nothing to import" is the honest
  summary of what we may see, matches the create arm's pre-grant terminal state, and the
  grant-flip poll corrects it on a late grant. Gating on FR_SCAN_FULL instead would strip
  the reassuring close from every declined/ungranted adopt user (incl. the genuinely-empty
  majority) to protect the narrow declined-with-Documents case. His copy call; one-line
  change (require FR_SCAN_FULL) if he wants it.
- **Reused frPaintScan** rather than appending import rows to the adopt box, matching the
  create/unknown arms and avoiding a second surface for the Add/Skip handlers.
- **Browser-check gate (#1720):** satisfied by a `Browser-check:` trailer, not a
  docs/browser-checks change. Reason: the frPaintScan render it hands to is already
  browser-covered by render-scan-board.js; #2389 changes only which PATH reaches it, which
  is pure branch logic covered by node tests + perturbation; the fleet cannot run browser
  checks (#1769). Follow-up for a browser session with the box: extend render-adopt-1531.js
  with an adopt-path -> frPaintScan assertion so a wired regression is caught there too.

## Tests (web.found-every-path-1493.test.js, branch-level, perturbation-proven)
Added a `box` field to the harness return and threaded `FR_SCAN_INFLIGHT` through both
frPaintFleet harnesses (this file's `paint` and server.test.js's `firstRunHarness`,
defaulting falsy so pre-existing assertions read their usual branch). 10 new `#2389`
assertions (20 tests total in this file, all green; server.test.js 263/263 green):
- adopt path fires the disk scan (SCAN-SEARCH), the #2389 gap.
- the scan waits for the found search (FR_FOUND===null) so it fires once not twice.
- while scanning / mid-partial (FR_SCAN_INFLIGHT), the box does NOT assert "nothing to
  import"; heading kept.
- a folder candidate and loose importable FILES both route to frPaintScan (+ ARM-RESCAN).
- retry-exhausted `scanning:true`, hard `{ok:false}`, and `bounded.tccUnavailable` each do
  NOT assert the verbatim.
- CONTROL: running fleet + genuinely clean empty disk -> the verbatim still renders,
  proving the ruled string was not touched.
Perturbation: each gate was individually reverted and reds exactly its guarding
assertion(s) while the CONTROL stays green (the clean-empty path is unchanged).
