# Plan: Agents top chips, clickable Issue/No-project filters; don't false-error "No project" (#3423)

## Problem (Josh, live 0.6.88 side-note)
The Agents top chips show "⚠ 1 Issue" and "⚠ 1 No project", both red-triangle. Josh: (1)
"No project" reads as an error but making an agent and not assigning a project yet is normal, not
broken; (2) make "Issue" (and "No project") clickable filters like the Messages tile, across all
three agent views, so he can click and jump to the one agent.

## Semantic finding (grounded in code, read before building)
- "No project" tile `st-attn-noproj-tile` (#1898) counts ONLY `needsYouUnattributed` =
  `a.state==='needs_you' && a.stateProject===null` (engine/status.js:6890). It is a RED drill-down
  SUBSET of "Issue", NOT benign unassigned agents. A newly-created unassigned agent that does not
  need you lights NO tile. So Josh's "unassigned = flagged broken" is a misread of the label.
- `a.stateProject` is per-agent on every /api/status card (engine/status.js:6170), so the no-project
  predicate is fully client-side. This whole card is MY lane (no engine work).

## Decision
- **BUILD:** make "Issue" (`st-attn-tile`) and "No project" (`st-attn-noproj-tile`) clickable filter
  toggles, mirroring the Messages tile filter (setMsgFilter, generalized to setBoardFilter; CSS near
  the #st-dm-tile block; markers `data-has-msgs` in renderers). This also resolves the confusion:
  clicking "No project" jumps to the actual agent, which is a needs-you agent, not a broken
  unassigned one.
- **DON'T (documented, not blocked):** do NOT demote/de-red "No project". It's a real
  needs_you issue (#1898); dropping its alert hides a needs-you agent (regresses a documented
  Josh-approved design). Benign unassigned agents are already not flagged. Follow-up if Josh wants
  the label changed or a separate benign-unassigned concept.

## The "Issue" predicate (confirmed against code)
The `data-attn` marker MUST match whatever the "Issue" tile counts, or clicking "Issue N" shows
not-N agents (the "one fact two fields fails silently" trap). Confirmed the tile is filled from
`counts.needsYou` (engine/status.js:6882 = `a.state==='needs_you'`), so:
- `data-attn` = `a.state==='needs_you'` (matches `counts.needsYou` byte for byte).
- `data-noproj` = `a.state==='needs_you' && a.stateProject===null` (matches `counts.needsYouUnattributed`, status.js:6890, and #1898).

Note the divergence from the visual `.attn` CSS class: `cardStOf(a).st==='attn'` folds in
needs_trust as well, so a needs_trust card reads red. That card is deliberately NOT marked
`data-attn` (see the needs_trust decision below).

## needs_trust decision (challenge-loop iteration 2)
A needs_trust card (Windows workspace-trust prompt, running:false + needsTrust) wears the red
visual `.attn` class but is NOT in `counts.needsYou`, so it is NOT marked `data-attn` and the Issue
filter excludes it.
- **Call:** keep `data-attn = needs_you` so the filter matches its chip count exactly. A filter that
  showed a needs_trust card under "Issue" would show more cards than the "Issue" chip counts, which
  is a lie about the count.
- **Rejected:** adding needs_trust to `data-attn`. It breaks count/filter parity, and whether
  needs_trust should be an "Issue" is an engine-count question (`counts.needsYou`), not this UI
  change's. If that count ever includes needs_trust, the uniform `data-attn` predicate follows
  automatically at every render path.
- **Why the markers stay on the running:false branches (not "dead code"):** `counts.needsYou` keys
  on state alone regardless of `running`, so the uniform `data-attn` predicate at every branch is
  what guarantees parity if the implicit running/state invariant ever changes. Removing it would
  create a latent mismatch.
- **Guard:** render-chip-filters-3423.js has a needs_trust arm asserting the card keeps its red
  visual but carries neither `data-attn` nor `data-noproj`, so a future refactor that merges the two
  sets fails the check.
- **Weakest premise:** that Josh reads "Issue" as needs_you (an agent waiting on an answer), not as
  every red card. Reversible in one line if he wants needs_trust folded in, and that belongs in the
  count, not the marker.

## Build (as shipped)
1. Renderer markers (inline, self-contained, lifted+eval'd by tests): the three card() branches,
   the three lrow() branches, and onode(). `data-attn`/`data-noproj` beside `data-has-msgs`.
2. CSS: mirror the #st-dm-tile block for `#st-attn-tile`/`#st-attn-noproj-tile` (id-keyed, no new
   classes) + `body.filter-attn`/`body.filter-noproj` hide (grid/list) + dim (org). Exit selector
   extended to any filter-* class.
3. Tiles: role=button tabindex=0 aria-pressed=false + title on both new tiles.
4. JS: generalize setMsgFilter to mutually-exclusive `setBoardFilter(facet)`
   ('msgs'|'attn'|'noproj'|null); wire click+keydown on the two new tiles; shared exit clears any
   facet; auto-exit when a facet's count hits zero (guarded by document.body for the lifted tick()
   unit tests).
5. Browser-check render-chip-filters-3423.js (real server + real card()): markers, the
   attn-vs-noproj distinction, the needs_trust divergence, setBoardFilter mutual exclusivity, CSS
   hide + exit restore, tile click toggle. Wired into the runner + README + surface annotation.
6. Challenge-loop -> PR (Addresses #3423, non-closing) -> CI -> merge -> verify -> remove worktree.

## Weakest premise (build)
That Josh's underlying want is "don't make unassigned agents look broken + let me click to the
agent" (satisfied by clickability + the #1898 truth), not "literally remove the red from this tile"
(which regresses #1898). Reversible; he can redirect.
