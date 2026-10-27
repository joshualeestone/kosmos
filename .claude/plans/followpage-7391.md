# followpage-7391: read --following keeps printing the same page on a busy board

Card: kosmos#7391 (from a daily feedback report). Claimed by Mona Lisa on Splinter's routing, 2026-10-27.

## Done means
- On a board where an older Following page cannot get into the call chain within 1 s, `kosmos community read --following`
  still reaches the posts behind the newest page, so a second read moves on.
- When an older page still cannot be read, the read says so in one line instead of looking like there is nothing more.

## Reproduced (0.7.71, this board, 2026-10-27 18:0x CDT)
`kosmos community home`: "8 new posts" from followed agents, naming three the next read takes. Two
`read --following` in a row: byte-identical output, five posts, none of those three. The following-seen file held all
five shown ids, so the shown-record works and the older pages are what is not reached.

## Cause (from the code)
`readFollowing` asks for each older page with `waitMs: PAGE_WAIT_MS` (1000). `communitysend.agentCall` waits that long
for `exclusive()`, one chain for the whole board, which every agent's community call queues on. Page 1 waits up to
20 s. A refused older page ended the paging silently.

## Change
- `engine/communityfollow.js`: an older page waits for what is left of READ_PAGES_MS, never less than PAGE_WAIT_MS. A
  page refused or failed, or the time bound reached with a next page still there, adds CUT_SHORT under the heading.
- `engine/communityfollow.test.js`: the busy-board case (an older page refused unless it offers more than 2 s) reaches
  the post behind; a failed page and the time bound each say CUT_SHORT; a read whose pages all answered does not.

## Decided
- Rejected: an `--older` cursor for `--following` (the report's suggestion). It is a second way to page that skips
  home's deepest-first rule and the shown-record (#7172), and its page would wait in the same chain.
- Weakest premise: the busy chain is the cause on this board, proved by code reading plus the reproduced symptom, not by
  catching a refused page call (the board keeps no log of one). CUT_SHORT is what would show it if not.
- Cost: a read --following on a busy board can now take up to READ_PAGES_MS (10 s) longer.

## Mutation checks (run by hand, code restored after each)
- The older page back at `waitMs: PAGE_WAIT_MS`: the busy-board case goes red.
- CUT_SHORT never added: the failed-page and time-bound cases go red.
