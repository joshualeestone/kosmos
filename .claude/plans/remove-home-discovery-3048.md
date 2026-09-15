# Plan: remove the permanent home "Look for agents" button (#3048)

## What finished looks like
- The Agents home board no longer renders the permanent "Look for agents already
  on this computer" trigger, nor its two on-demand panels (found #2651, scan #1938).
- Adding agents still works from the New Agents tab (paste import #1652/#2563).
- First-run S9 (the onboarding found/scan step) is UNCHANGED and still works.
- No dangling references: no unguarded `getElementById` on a removed id, no CSS
  selector styling a removed element, no browser-check or unit test asserting the
  removed markup.
- The removal is guarded against regression by a browser check that reds if the
  markup returns.

## The decision (documented on the card, comment 5675407867)
REMOVE the button (not relocate the scan). Josh's ask is clear and repeated, and
aligns with his consistent wariness of this auto-scan (the whole #2651 gate exists
because he distrusted it). Reversible. Weakest premise, flagged on the card: he may
want the scan KEPT-but-relocated, in which case the one-line pivot is relocate into
New Agents. His stated reason ("import already covers it") is factually inverted
(New Agents has PASTE import, not this computer-SCAN); building the removal anyway
on his INTENT, premise flagged for his morning override. Angel (found-agents lane
owner) cleared removal > relocate and will review the PR.

## The delicate part: shared with first-run S9 (do NOT remove these)
The discovery frontend is interleaved with first-run S9 through shared code:
- `paintFoundBoard` / `paintScanBoard` / `paintDiscoveryTrigger` are called
  typeof-guarded from the shared document-level `.fr-adoptundo` handler (which
  first-run scan/found rows also use). KEPT. They null-guard on their DOM elements,
  so with the home markup gone they early-return (no-op) rather than throwing.
- `foundRowsHtml` / `adoptRowsHtml` / `scanRowsHtml` build both the (removed) home
  panels AND the first-run rows. KEPT.
- `DISCOVERY_OPENED` and the other gating vars are read by the kept painters. KEPT.
- `.found-dismiss` / `.found-x-say` CSS is a documented colour precedent for
  `.skillrm.armed` (web.ask-first-1683.test.js references it). KEPT.
- Angel's `/api/found-agents` + `/api/scan-agents` engine. UNTOUCHED.

## Scope removed (home-only)
1. Markup: `#found-scan-trigger`, `#found-wrap`, `#scan-wrap` (KEEP `#removed-wrap`).
2. Home poll-calls to the three painters at both poll sites (KEEP paintRemoved/paintSurvival).
3. Off-tab hide-refs for those three ids (two were NOT null-guarded, so leaving them
   would throw once the markup was gone).
4. Home-only handlers: found-scan-look press, found/scan toggle, found/scan dismiss.
5. Home CSS: `.found-head/.found-lead/.found-desc/.found-show`, `#found-list`/
   `#scan-list` rules, consolidated-hide entries; shared `#firstrun` rules trimmed
   to firstrun-only (every `#firstrun` selector kept byte-identical).

## Tests
- Deleted render-found-board.js / render-scan-board.js / render-discovery-gate-2651.js
  (they tested the removed feature) + their driver refs + README rows.
- Added render-home-discovery-removed-3048.js: an absence guard. Proven it can fail
  (reds on origin/main's page, exit 1) and stays green on the kept painters.
- Updated web.found-board.test.js (off-tab-hide assertion) and web.layout-picker.test.js
  (consolidated-hide selector) to guard the removal instead of the removed behavior.
- Full suite green: 7552 pass, 0 fail, 138 skipped.

## Verification
- grep: all removed markup ids = 0; remaining getElementById calls are all inside
  the three null-guarded painters.
- Inline JS parses (node --check on both script blocks).
- New browser check 6/6 green; negative control against origin/main reds the two
  absence arms (exit 1).
- Browser-check wiring meta-tests (wired/selectors/reason-grep/every-test-runs) 20/20.

## Next
challenge-loop -> PR (@Angel review, NO --reviewer, Addresses #3048 non-closing) ->
CI green -> merge on green (squash, no --admin). Leave #3048 OPEN for Josh's morning
override since the premise was inverted.
