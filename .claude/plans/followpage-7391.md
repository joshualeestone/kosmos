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
- `engine/communityfollow.js`: each older page waits for the board's chain for what is left of two bounds, never less
  than PAGE_WAIT_MS: READ_PAGES_MS (10 s) from the newest page's answer, and READ_TOTAL_MS (20 s) from the read's
  start. A page refused or failed, or a bound reached with a next page still there, adds CUT_SHORT under the heading.
  Stopping at FEED_PAGES_MAX is the read's depth, not a cut, and says nothing.
- `engine/communityfollow.test.js`: the reported case through the real chain (another agent's call holds it about 1.5 s
  between the newest page and the older one); the slow newest page; the whole-read bound; CUT_SHORT on a failed page, the
  time bound, an empty read and a read that took POSTS_WANTED posts, and not when all pages answered or at FEED_PAGES_MAX.
- `engine.reachable.test.js`: the two read-bound test seams say what they set.

## Decided
- Rejected: an `--older` cursor for `--following` (the report's suggestion). It is a second way to page that skips
  home's deepest-first rule and the shown-record (#7172), and its page would wait in the same chain.
- Weakest premise: the busy chain is the cause on this board, proved by code reading plus the reproduced symptom, not by
  catching a refused page call (the board keeps no log of one). CUT_SHORT is what would show it if not.
- Board-wide cost, accepted: an older page that now gets in holds the one chain while it runs (each request is cut at
  5 s), so other agents' calls and the send sweep can queue behind up to two more requests per read. That is the cost
  #7172 already decided on ("every older page is read on every read: at most two more requests per read"); the 1 s wait
  had been cancelling it on busy boards, which is this bug. Not measured: how much longer other agents wait on a busy
  board with several Following readers.
- READ_TOTAL_MS is 20 s because the commands stop asking after about 24 s (5 asks of a 4 s wait and a 1 s pause). When
  the newest page answers quickly the read ends while they still ask, so the agent's next community step (a vote) is not
  answered busy by a read still running. A slow newest page can still carry the read past 24 s (an older page asked for
  near the 20 s mark runs up to 5 s); the finished answer then waits for the next ask. When the newest page itself
  waited most of 20 s, the older pages get no time and the read says CUT_SHORT.
- CUT_SHORT is conservative: it is said whenever an older page was not read, even when the read took POSTS_WANTED
  posts, because the page it missed may hold the deepest ones (the next to pass the depth edge). Rejected: hiding it
  once the read took POSTS_WANTED unseen posts. A cut-short answer asked for again within 30 s is the same answer
  handed out again (readjobs RESEND_MS); "in a minute" sends the agent past that.
- While an older page waits, this agent's own other community calls are answered busy at once, for up to about 10 s
  instead of 1 s. If one of its own calls is running, the older page is answered busy and the read says CUT_SHORT. Not
  measured: how each other caller of agentCall treats a busy answer.

## Mutation checks (run by hand, code restored after each)
- The older page back at `waitMs: PAGE_WAIT_MS`: the real-chain case goes red on its own (checked with the waitMs
  assertion switched off), and the waitMs assertion goes red.
- CUT_SHORT never added: the failed-page, time-bound and empty-read cases go red.
- The bound counted from the read's start again: the slow-newest-page case goes red.
- CUT_SHORT set whenever a next page is left: the FEED_PAGES_MAX case goes red.
- No whole-read bound: the whole-read case goes red.
