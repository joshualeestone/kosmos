# #2576 + #2577 — org-chart context ring on every node + needs-you corner badge

Branch `orgchart-rings` off origin/main aedffe46. ONE PR (they share the org node render). web/index.html only + tests.

## What finished looks like
Every org-chart node draws the SAME context gauge the grid/list/detail views draw (orgRing, off pctOf/memBand); a needs-you agent shows a red warning-triangle+exclamation CORNER badge (top-right, the list row's exact glyph) INSTEAD of the old red partial-arc ring; the two signals coexist (ring = context always, badge = needs-you when true). Working/unknown/resting states carry no ring or badge (context ring only). Verified by a hermetic browser-check driving paintOrg with fixtures + node tests, full suite green, challenge-loop converged.

## Mona's authoritative spec (#2577 comment)
- Badge = the SAME warning-triangle glyph the "Needs you" pill/tiles use (reuse, do not redraw). Top-right corner, overlapping the edge. ~40-45% of avatar dia. Thin GROUND-colour halo (page bg, not white; holds in dark). Needs-you ONLY.
- Ring = the EXISTING grid/list context ring, same colours/meaning, now on every node. That is #2576.

## Design decision I made (reversible; documented for Mona)
The `work` (green top arc) and `unk` (dashed) `.onode::after` state arcs sat at the SAME radius as the incoming context gauge, so they would collide. Mona's spec resolves it: "Idle/working agents show the context ring only, no badge." So ALL state arcs come off the ring: attn -> corner badge, work/unk -> folded. This matches the list-row precedent exactly (list row = context ring + needs-you triangle, NO state arc; state lives in the state cell). Consequence: working/unknown lose their at-rest arc in the compact org view (idle already had none, deliberately); identity/role still on the hover callout, needs-you still marked. What would change my mind: Mona wanting a distinct working/unknown channel in the org view (she owns the look; a follow-up, not a blocker).

## Implementation (web/index.html)
1. CSS ~1338-1347: replace the `.onode::after` state-ring block (+ `.onode.attn/.work/.unk::after`) with `.onode .oring` (absolute, inset:-5px, pointer-events:none) + `.onode .owarn` (absolute, top/right:-3px, ~19x17px, pointer-events:none).
2. CSS ~1384-1385 and ~6417-6418: drop the dark `.onode.attn/.work::after` overrides (keep the `.onode .face` bg lines). `.gt`/`.gf` already have dark overrides (5666/6463) so the ring themes for free.
3. `const ONODE_WARN = LROW_WARN.replace('class="lwarn"','class="owarn"')` right after LROW_WARN (~13255) — derived, so the glyph CANNOT drift from the list row.
4. `function orgRing(a)` after detailRing (~13279): same pctOf/memBand/.gt/.gf shape as detailRing (viewBox 100, r47, sw4); null pct -> ''.
5. paintOrg node loop (~18971-19003): `const needsYou = cardStOf(a).st === 'attn'` (drop `st`/`ring`); class fixed `"onode"`; insert `orgRing(a)` before `.face` and `(needsYou ? ONODE_WARN : '')` after `.face`. Rewrite the stale "three states draw a ring" comment.

## Verification
- web.org-view.test.js: isolated orgRing (arc tracks reading / fuller->longer / band thresholds / unknown->'') via slice+new Function; node-build wiring (calls orgRing(a); badge gated on `st==='attn'`; class has no state-arc append; ONODE_WARN shares LROW_WARN's path).
- docs/browser-checks/render-org-rings-2576.js (NEW, #1720 net assertion): sandboxed fleet.install with a needs_you agent + others, real server, org layout, inject context readings, re-drive paintOrg; assert a .oring/.gf on EVERY node with arc tracking its reading, an .owarn on the needs-you node ONLY, and NO red `::after` arc on any node. RED arm documented.
- Full run-tests.sh EXIT=0. challenge-loop to convergence. LITERAL cd gh pr create. Squash-merge on green.
