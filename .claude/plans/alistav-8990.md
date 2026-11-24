# alistav-8990: a poll that changes nothing rebuilds no agent avatar (kosmos#8990)

## Report
One agent feedback report (0.8.18): agent avatars seem to reload continuously in the discussion view.

## Reproduction (measured, throwaway board, main 12dce83079 then 87918b0c75)
Project room with two avatar agents, Playwright + MutationObserver + response listener.
- 56 avatar `<img>` added/removed and 54 avatar fetches in 130 s (12dce83079).
- Located by ancestor path: `#alist .lrow .lav img` (the agents rail) and `#grid .acard .agauge svg image`
  (the card grid, painted every poll even while hidden behind the room). 32 rebuilds and 16 fetches in 40 s.
- Cause: `paintAgentListNow` and the tick's `paintGrid` / `repaintAgentOrder` wrote `innerHTML` unconditionally
  every poll. Agent avatars are served `cache-control: no-store`, so each rebuilt node fetched again.

## Decision
Write `#grid` and `#alist` only when their markup changed, compared against the string last WRITTEN (the
`MY_AGENTS_HTML` rule My Agents already follows; innerHTML is reserialized by the browser so it cannot be
compared). `setGridHtml` is the grid's one writer for both paint sites. The tick's failed-poll path writes both
containers directly, so it clears both memos (as it clears `ORG_HTML`).

Rejected:
- Versioning the agent avatar URLs (`?v=avatarVer`) alone: the route is `no-store`, so a rebuilt node refetches
  whatever its URL. It would also not stop the rebuilds.
- Making the avatar route cacheable: a server change with its own risks (avatar replace must show at once); the
  page-side change removes the steady-state refetch on its own. Left as a possible follow-up, noted on the card.
- `setLive` / `setIfChanged` (shape compare): its shape rules are for thread markup; an exact compare is the
  simpler and stricter rule for these rows.

Weakest premise: that nothing else writes inside `#grid` / `#alist` in place. Swept: only the failure path
(handled) and the just-made mark (toggles a class each 150 ms and clears it at the end of its window, so it is
unaffected by skipped writes). A future in-place writer would need to clear the memo.

What it does not cover: a running agent whose card markup changes every poll still rebuilds that card, and its
avatar refetches. That is a real change.

## Tests
- New: `docs/browser-checks/render-avatar-steady-8990.js` (self-contained, wired in tools/browser-checks.sh).
  Steady arm (counts polls so it cannot pass vacuously) + change arm. RED on base 3/7; never-write mutant 2/7.
- `render-phone-offline-718` caught the failure-path memo hole (fixed; 20/20).
- `render-working-pulse-3956` relied on idle polls rebuilding; its watch now forces rebuilds and reads on the next
  frame. Passes chromium + webkit; fails with the pulse pin disabled.
- Source pins updated: web.agent-sort-4428, web.board-empty; SITE_COUNTS entry in browser-checks-reason-grep.
