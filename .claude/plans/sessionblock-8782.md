# sessionblock-8782: an automatic provider block ends at the next run's normal turn end (kosmos#8782)

## Problem (measured on Agent1s, 11-19)

The fleet relaunched at 08:14 CST after the tmux server died. Just before the crash, Claude Code's StopFailure hook
wrote an automatic `blocked` on "provider api (an api error)" for April, Angel and Splinter (14:12:48Z, each from its
pre-crash instance). Every automatic report from their new sessions was then refused for about 12 hours of work:
`selfreports/<name>.jsonl` ended at that block, while five other builders had hundreds of rows. Cards read
blocked or Waiting, a PM check counted April at rest, and `kosmos away` (#8548) found no earlier report.

Cause: `engine/selfreport.js` (#6209) lets an automatic idle clear an automatic provider block only for the
transient kinds. The hook's fallback kind "an api error" is deliberately not on that list, so only a deliberate
report clears it, and the agent never sees that it needs one.

## Change

In `selfreport.record`, an automatic `idle` also ends an automatic provider block (any `provider api (...)` kind)
when the block's run no longer holds a token: both rows carry an `instance` (from the launch token), they
differ, and the token store says the old run's token is gone (`sendertoken.instanceState` = 'gone'). Two live runs of
one agent can overlap (#570), so a sibling run's turn end must not end the other's block; 'held' or 'unknown' keeps
it. Measured on 11-19: April's, Angel's and Splinter's token files hold only their new instances, so their crashed
runs read 'gone'.
What sits under the run of blocks is read with the existing #6209 rule: a block that covered a deliberate wait, or
an unreadable record, keeps the block. For this case the walk steps over automatic provider blocks of any kind from
runs whose token is gone (two crashes in a row included), and stops at a block from a run still holding a token or of
unknown standing (`lineUnderProviderBlock(sessionName, goneRuns)`). A transient block
keeps #6209's walk, so a gone run never makes a block harder to clear than main does.

Unchanged: the same run keeps #6209's rule ("an api error" stays within a session); a mid-turn `working` never
clears a provider block; deliberate blocks and automatic blocks that are not about the provider are untouched; an
unknown instance on either side is not treated as a new run.

## Rejected

- Adding "an api error" to the transient list: simpler, but it reverses #6209's stated residual inside a session.
- Clearing on any report from a new run (`working` too): a mid-turn heartbeat does not prove a turn succeeded.
- Sending `started` on a resumed session: #1058 chose not to, so a resume does not wipe a deliberate wait.

## Stated residual

A block from the old run followed by the NEW run's own non-transient block: the standing block is the new run's, so
the same-run rule decides and keeps it (pinned by a test). Rare, and it fails toward keeping the block.

## Cost and a known edge

The token file is read (once per instance) only on an automatic idle that lands over an automatic provider block from
another run, so it is bounded to that rare moment. A run whose token was replaced while its process still runs reads
'gone'; such a process's own reports are refused by its missing token anyway.

## Weakest premise

That a turn ending normally in a new run means the old failure needs nobody. For a usage limit or a sign-in, the
new turn could only end normally if the limit or sign-in was already resolved, so the block is stale either way.
If the new run hits it again, StopFailure writes a fresh block.
Not every automatic idle is a turn end (a front's startup idle, an agent running `report idle --auto` itself). #6209
already accepted that within a run; across runs this widens it to every kind, only when the old run's token is gone.

## Not in scope (noted on the card)

A resumed bot session (launched with resume) never reports `started`, so `kosmos away`'s window cannot start from a
restart for those agents. That is a separate question about #8548.

## Tests

- `engine/selfreport.anotherrun-8782.test.js`, 16 tests: the 11-19 case; a same-run control; a new run's working
  vs its idle; any kind, and a run of several; a deliberate question under the block; unknown instances on either
  side; deliberate and non-provider blocks; two live runs overlapping (with a flip to gone as the control); no token
  file; the new run's own block over the old one (the residual); a live sibling's block under the gone run's; a gone run's
  transient block over a live run's transient block (cleared, as on main); a `legacy` instance (kept); two gone runs
  in a row (cleared); the old run's permission prompt under its block (cleared); a live run's transient block under
  a gone run's (cleared).
- Mutation checks: main's `selfreport.js` fails the clear cases; the token check removed fails the overlap and
  no-token-file tests.
- The existing `engine/selfreport.autoclear-2456.test.js` and `engine/selfreport.test.js` pass.
- Full validation on the final head.
