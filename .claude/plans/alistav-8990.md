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

Added in review (round 2):
- The grid card's SVG image, the three list-row imgs and the room's working line (busyRow + busyKey) carry
  `?v=<avatarVer>`, as the org chart and room members already do (#2698's rule). Without it a changed picture left the
  markup identical and the memos kept the OLD picture.
- A failed avatar in the grid or list is retried by the failed element alone (`retry=N` on its URL) after 5, 10, 20 and
  40 s, then left. Rebuilding every poll used to retry by accident. Round 3: a first version cleared the container's
  memo on error, which let ONE broken picture bring the every-poll rebuild back for everyone; replaced.
- Browser checks that waited for an idle poll to rebuild cards or rows (teamcreate-4557, working-pulse-3956,
  federation-invite-4649, ownseal-4658) now force the rebuild (forget the memo, repaint) and assert it happened;
  star-6719's list-repaint arms could pass without keepStarFocus and now assert the star was replaced.
- web.board-memo-8990.test.js pins the writers of #grid and #alist, so a new writer behind a memo fails a test.

Rejected:
- Versioning the agent avatar URLs alone (without the memo): the route is `no-store`, so a rebuilt node refetches
  whatever its URL, and it would not stop the rebuilds. Versioning is now done WITH the memo, for the reason above.
- Making the avatar route cacheable: a server change with its own risks (avatar replace must show at once); the
  page-side change removes the steady-state refetch on its own. Left as a possible follow-up, noted on the card.
- `setLive` / `setIfChanged` (shape compare): its shape rules are for thread markup; an exact compare is the
  simpler and stricter rule for these rows.

Weakest premise: that nothing else writes inside `#grid` / `#alist` in place. Swept: only the failure path
(handled) and the just-made mark (toggles a class each 150 ms and clears it at the end of its window, so it is
unaffected by skipped writes). A future in-place writer would need to clear the memo.

What it does not cover: a running agent whose card markup changes every poll still rebuilds that card, and its
avatar refetches. That is a real change.

Deferred (round 3): `fedOwnRefocus` sets tabIndex=-1 on the rail's .fmsg/.fedout-h, which no longer vanishes at the
next poll. tabindex -1 is not in the tab order, so it only makes that element a programmatic focus target; left.
Deferred (round 3): the forced-rebuild arms stand in for a poll that changed a card. The write is the same
(setGridHtml / innerHTML), and render-avatar-steady-8990's arms 2 and 3 cover a real poll-driven repaint.

## Tests
- New: `docs/browser-checks/render-avatar-steady-8990.js` (self-contained, listed in docs/browser-checks/gated.txt).
  Arm 1 steady (counts polls, asserts the fixture pictures decode), arm 3 a new picture replaces the avatar element,
  arm 4 a failed picture retries by itself and beta is not refetched, arm 2 a session ending repaints. Results for
  the current version are on the card; the first version was RED on base 3/7 and a never-write mutant failed 2/7.
- `render-phone-offline-718` caught the failure-path memo hole (fixed; 20/20).
- `render-working-pulse-3956` relied on idle polls rebuilding; its watch now forces rebuilds and reads on the next
  frame. Passes chromium + webkit; fails with the pulse pin disabled.
- Source pins updated: web.agent-sort-4428, web.board-empty; SITE_COUNTS entry in browser-checks-reason-grep.
