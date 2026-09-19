# Messages filter — filter the agents board to agents with messages

Branch: `messages-filter` · Repo: joshualeestone/kosmos · Owner: Mona Lisa

## Source of truth
Josh, #chaoskosmos-design 2026-09-19 (spec relayed via Splinter): the agents-board Messages count pill becomes a clickable TOGGLE that filters the CURRENT agents view (grid / list / org, never forcing a view change) to only agents with 1+ messages. Active pill state + a "View all agents" text link to exit; clicking the pill again also exits.

## Done-condition
- The `#st-dm` "Messages" tile is a toggle; clicking it filters the agents board to agents with `a.dmUnread > 0`.
- Grid + List HIDE the no-message rows; the org chart DIMS them while keeping the tree.
- Active pill (aria-pressed) + a "View all agents" exit link shown only while filtering; second click + link + auto-exit-at-zero all exit.
- The grid/list/org selection is preserved (never touches BOARD_LAYOUT).
- Covered by a browser-check assertion (render-dm-badges-2863.js) so it cannot silently regress.

## Approach (web/index.html, CSS + JS)
- `hasMsgsAttr(a)` emits `data-has-msgs` when `a.dmUnread > 0`, added to EVERY agent-row root (card()/lrow() main + not-running early-returns, and the org onode).
- `#st-dm-tile` -> role=button aria-pressed toggle; `setMsgFilter()` sets `body.filter-msgs`.
- CSS: `body.filter-msgs` hides `#grid .acard:not([data-has-msgs])` / `#alist .lrow:not(...)`, dims `#orgview .onode:not(...)`, and shows `.board-msgfilter-exit`.
- Auto-exit when the Messages tile hides (dmTotal <= 0 or status unknown).

## Decisions (reversible)
- Org: DIM (not flatten/collapse) so the hierarchy + wires stay; flatten forces a view change, collapse orphans children of no-message parents.
- Filter on `dmUnread` (the tile's own signal); the board exposes no "all-history" count.
- Not persisted (transient view state).
- Agents board only; the projects Messages tile is untouched.

## Weakest premise
That `a.dmUnread` (unread) is the "messages" Josh means. If he wants "any conversation ever," that field is not on the board and would need a server addition. The org DIM opacity and the exact exit-link placement are one-number nudges Josh can adjust in-app.
