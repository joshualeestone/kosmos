# #5272: the main canary waits first among waiters, so a wake or PASS-sleep never sends it to the back

## The problem
The main canary runs the full suite on origin/main's tip through the normal queue. Each new run joins at the BACK,
behind every heavy job queued before it. On 2026-10-04 that was about 6 h (queued 12:41, ran 17:58), then 2.3 h
(18:22 to 20:42), then about ten heavy jobs again after a wake at 21:05. Under Splinter's 19:29 ruling, the canary is
the backstop for merges that skip a re-run, so hours of lag defeat it.

## Design (agreed with Angel, the queue's author, 21:10)
Ordering only, in `tools/lib/cut-guard.sh`, exactly like the light lane (#4609). It changes the ORDER among waiters,
never how many runs hold the box, and it never pre-empts a running job.
- `_kosmos_queue_class`: `KOSMOS_QUEUE_CLASS=canary` is recorded as `canary` on line 5 of the waiter file. Anything
  unknown is still heavy.
- `_kosmos_queue_rank`: a new top rank. canary 0, then a starving waiter 1, light 2, heavy 3. The order is still
  rank, then queue time, then pid.
- **One canary at a time.** In `_kosmos_suite_waiters_ahead`, only the OLDEST live canary waiter (queue time, then
  pid) ranks as canary. Any other canary waiter ranks as heavy, so naming yourself canary cannot jump the queue twice.
  Every reader computes the same "first canary" from the same markers, so they all read one order. A demoted canary
  is told so in its refusal line.
- `_kosmos_queue_rank_legacy` is unchanged. While a waiter from an older lib is live, every reader uses the older
  rule, under which canary is heavy (the older libs do not know the class). So all readers still agree.
- `tools/run-tests.sh` forces a full suite to heavy whatever it inherits (#4609 review). It now lets `canary`
  through, and only canary: a light class inherited is still forced to heavy. The existing line is kept as written,
  because a test strips it to build its control.

## Starvation (Angel's point 3)
A canary ranks ABOVE a starving waiter. Ranking it equal (rank 0, broken by queue time) would put it behind every
heavy job that has waited 45 minutes, which is most of a busy day, and that is the bug. The cost is bounded: there is
one canary at a time, and it runs about 25 minutes.

## Mixed generations
Workers run run-tests.sh and the lib from their own worktrees, so older libs stay live for days.
- A 6-line marker written by a #4911 lib (which does not know canary) reads the canary as heavy. That reader may then
  think itself ahead of the canary, while the canary thinks itself first. That gives two runs each reading themselves
  first, which the claim and the live-suite checks already serialise. It is never a cycle of waiting: the canary
  names nobody ahead of it, so no chain can close back on it.
- A 5-line or older marker switches every reader to the legacy rule, where canary is heavy.

## Tests (tools/test-cut-guard.sh, beside the #4609 arms)
- A canary goes ahead of an older STARVING heavy waiter. CONTROL: a heavy run in the same place waits.
- A heavy run keeps its place behind a canary waiter that queued after it.
- Two canaries: the older keeps canary rank; the newer queues as heavy behind an older heavy waiter, and is told so.
- The marker records canary on line 5. An unknown class is still heavy.
- run-tests.sh queues as canary when started with KOSMOS_QUEUE_CLASS=canary, and still as heavy with light.

## Rejected
- One reserved slot per N heavy jobs: needs a per-N counter of past turns that no file in the queue keeps (Angel).
- A `--canary` flag on queued-heavy.sh: the canary calls run-tests.sh directly, and the installed wrapper must not
  change until #5064. Not needed.

## Weakest premise
That only the canary will set the class. Nothing stops a person from exporting KOSMOS_QUEUE_CLASS=canary on a normal
run. The one-canary rule caps the damage at one place. If it is abused, the next step is checking the waiter's
command line for the canary's worktree.
