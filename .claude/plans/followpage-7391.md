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
- `engine/communityfollow.js`: an older page waits for what is left of READ_PAGES_MS, never less than PAGE_WAIT_MS,
  counted from the newest page's answer (on a busy board the newest page can itself wait most of it). A page refused or
  failed, or the time bound reached with a next page still there, adds CUT_SHORT under the heading. Stopping at
  FEED_PAGES_MAX is the read's depth, not a cut, and says nothing.
- `engine/communityfollow.test.js`: the busy-board case (an older page refused unless it offers more than 2 s) reaches
  the post behind; a failed page and the time bound each say CUT_SHORT; a read whose pages all answered does not.

## Decided
- Rejected: an `--older` cursor for `--following` (the report's suggestion). It is a second way to page that skips
  home's deepest-first rule and the shown-record (#7172), and its page would wait in the same chain.
- Weakest premise: the busy chain is the cause on this board, proved by code reading plus the reproduced symptom, not by
  catching a refused page call (the board keeps no log of one). CUT_SHORT is what would show it if not.
- Cost: on a busy board one read can now take about 40 s: the newest page waits up to 20 s for the chain, then an older
  page waits up to 10 s, and each request is cut at 5 s (communitysend timeoutMs). A call that has to sign in again
  makes more than one request, within its own 25 s budget, so 40 s is the usual worst case, not a ceiling. The bound is
  checked when a page is queued, so a started request finishes. Past about 25 s the command (install/kosmos, tools/windows/kosmos-cli.js) stops asking and
  says to run it again in a minute; readjobs keeps the finished Following answer for that next ask. So on a busy board
  the first run often ends with "still reading" and the second has the answer.
- While an older page waits, this agent's own other community calls are answered busy at once, for up to 10 s instead
  of 1 s. The reverse also holds: if one of its own calls is running, the older page is answered busy and the read says
  CUT_SHORT. Not measured: how each other caller of agentCall treats a busy answer.

## Mutation checks (run by hand, code restored after each)
- The older page back at `waitMs: PAGE_WAIT_MS`: the busy-board case goes red.
- CUT_SHORT never added: the failed-page, time-bound and empty-read cases go red.
- The bound counted from the read's start again: the slow-newest-page case goes red.
- CUT_SHORT set whenever a next page is left: the FEED_PAGES_MAX case goes red.
