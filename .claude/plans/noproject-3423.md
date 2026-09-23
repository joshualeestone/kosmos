# Plan: Agents top chips — clickable Issue/No-project filters; don't false-error "No project" (#3423)

## Problem (Josh, live 0.6.88 side-note)
The Agents top chips show "⚠ 1 Issue" and "⚠ 1 No project", both red-triangle. Josh: (1)
"No project" reads as an error but making an agent and not assigning a project yet is normal, not
broken; (2) make "Issue" (and "No project") clickable filters like the Messages tile, across all
three agent views, so he can click and jump to the one agent.

## Semantic finding (grounded in code — read before building)
- "No project" tile `st-attn-noproj-tile` (#1898) counts ONLY `needsYouUnattributed` =
  `a.state==='needs_you' && a.stateProject===null` (engine/status.js:6890). It is a RED drill-down
  SUBSET of "Issue", NOT benign unassigned agents. A newly-created unassigned agent that does not
  need you lights NO tile. So Josh's "unassigned = flagged broken" is a misread of the label.
- `a.stateProject` is per-agent on every /api/status card (engine/status.js:6170) → the no-project
  predicate is fully client-side. This whole card is MY lane (no engine work).

## Decision
- **BUILD:** make "Issue" (`st-attn-tile`) and "No project" (`st-attn-noproj-tile`) clickable filter
  toggles, mirroring the Messages tile filter (setMsgFilter at web/index.html:23455; CSS at
  ~1755-1781; markers `data-has-msgs` in renderers). This also resolves the confusion: clicking
  "No project" jumps to the actual agent, which is a needs-you agent, not a broken unassigned one.
- **DON'T (flagged on the card, not blocked):** do NOT demote/de-red "No project". It's a real
  needs_you issue (#1898); dropping its alert hides a needs-you agent (regresses a documented
  Josh-approved design). Benign unassigned agents are already not flagged. Follow-up if Josh wants
  the label changed or a separate benign-unassigned concept.

## 🛑 OPEN CORRECTNESS DETAIL — confirm the exact "Issue" predicate BEFORE writing data-attn
The `data-attn` marker MUST match whatever the "Issue" tile (`st-attn`, data-count="attn") actually
counts, or clicking "Issue N" shows ≠ N agents (the "one fact two fields fails silently" trap).
Candidates that DIFFER on needs_trust / rate_limited / auth_failed:
- `STATE_COPY[a.state].attn === true` (web/index.html:14597+: needs_you, rate_limited, auth_failed = true; question = false)
- `cardStOf(a).st === 'attn'` (CARD_ST: needs_you + needs_trust) — used by the org "needsYou" glow (23081)
- `counts.needsYou` (engine: needs_you ONLY)
TRACE how data-count="attn" / st-attn gets its number (search the client counts application — the
code that reads `data-count` attributes and fills the tiles) and use THAT predicate for data-attn.
The `.attn` card CLASS (boardMods, m.st==='attn') is NOT necessarily the same set — do not assume it.
`data-noproj` is unambiguous: `a.state==='needs_you' && a.stateProject===null` (matches #1898).

## Ordered build steps
1. Confirm the Issue predicate (above).
2. Renderer markers (inline + self-contained — lifted+eval'd by tests): card ~15705/15720/15784,
   lrow ~15922/15935/15994, onode ~23122. Add `data-attn`/`data-noproj` beside the existing
   `data-has-msgs` append.
3. CSS: mirror 1755-1781 for `#st-attn-tile`/`#st-attn-noproj-tile` (id-keyed, no new classes —
   st-attn-tile is `class="stat alert"`, keep it) + `body.filter-attn`/`body.filter-noproj` hide
   (grid/list) + dim (org). Extend the `.board-msgfilter-exit` show selector to any filter-* class.
4. Tiles: add role=button tabindex=0 aria-pressed=false + title to st-attn-tile (14065) and
   st-attn-noproj-tile (14080).
5. JS: generalize setMsgFilter → mutually-exclusive `setBoardFilter(facet)` ('msgs'|'attn'|'noproj'|null);
   wire click+keydown on the two new tiles; shared exit clears any facet; auto-exit when a facet's
   count hits zero (mirror 17690/17934).
6. Browser-check render-chip-filters-3423.js (fixture: needs_you-with-project, needs_you-no-project,
   idle; assert hide/dim per view, mutual exclusivity, exit). Wire runner + README + surface annotation.
7. Challenge-loop → PR (Addresses #3423, non-closing) → CI → merge → verify → remove worktree.

## Weakest premise
That Josh's underlying want is "don't make unassigned agents look broken + let me click to the
agent" (satisfied by clickability + the #1898 truth), not "literally remove the red from this tile"
(which regresses #1898). Reversible; he can redirect.
