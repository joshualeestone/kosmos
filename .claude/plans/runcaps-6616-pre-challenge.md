---
method: challenge-loop
branch: runcaps-6616
diff_hash: 3c35e6bb4f997faed13cb20e3d52b93ce72fdeeb6e076576c5340387ac1d0b60
timestamp: 2026-10-21T08:33:06Z
subdir_audit: passed
iterations: 11
converged: true
---

# Challenge-loop proof: runcaps-6616 (kosmos#6616 R01b part 6, and kosmos#6669 R01c)

The board trusts a capability only if the binary AND the tunnel it runs list it (the running list read from the
status file under the child's pid, kept per pid), and it ends a tunnel an earlier board left running (parent 1, the
tunnel's own `run`, this board's exact `--status-file`). Eleven blind iterations, the reviewer model alternated
(Opus and Sonnet). Iteration 11 returned no WARNING, only nits, which were applied. Severities are the reviewers'.

| iteration | model | what it found (applied) |
|---|---|---|
| 1 | Opus | the orphan case overclaimed as closed; no child after a start did not fail closed; gate comment |
| 2 | Sonnet | no new defect; the orphan follow-up card asked for (kosmos#6669 filed) |
| 3 | Opus | an orphan's write refused every gated action (per-pid keep); then R01c built here |
| 4 | Opus | two live boards would kill each other's tunnels (parent 1 only); pid 0/-1; recheck before kill; /bin/ps |
| 5 | Sonnet | a live parent or gone pid was never asked again; Windows availability cost; stand-in gated |
| 6 | Opus | a test signalled a made-up pid (Linux CI); subreaper skip; argv vs kernel name (stated) |
| 7 | Sonnet | a vacuous bystander arm; the gated read stopped noticing foreign writers; hour TTL |
| 8 | Opus | the hour rule and the gone-pid minute unpinned; cleanup signalled reused pids |
| 9 | Sonnet | a second TERM inside the minute unpinned; no ps-failure backoff; wrapper lines matched |
| 10 | Opus | a request in flight while an orphan is being ended was trusted (refused now) |
| 11 | Sonnet | no WARNING: stale verdict on expiry, out-of-range verdict, kill-throw verdict, a dead arm |

Every rule added has a mutant that turns a test red (listed in the plan). 30 tests in
server.remotestepup-6595.test.js; with engine/remote.test.js and engine.reachable.test.js, 277 pass on the final
tree (3ad73fe0d5, one run). Earlier runs on pre-iteration-10 trees: 277 twice, and once 276 with
`#5786 (b): a Not me pressed after the secret stopped` red at 5.6 s, in engine/remote.test.js. That run overlapped a
second suite on the same machine AND my own edits to engine/remote.js, so it is not attributable either way; that
test's fake tunnel writes its own pid, so the foreign-tunnel path does not run in it.

## Iteration 1 (Opus)
[WARNING] the orphan case was claimed closed; it is outside both checks (narrowed, then kosmos#6669 built here)
[WARNING] no child running after a start fell back to the binary's answer (now fails closed)

## Iteration 3 (Opus)
[WARNING] an orphan's write to the shared status file refused every gated action until the child next wrote (per-pid keep)

## Iteration 4 (Opus)
[WARNING] two live boards on one account would end each other's tunnels in a loop (parent 1 only)
[WARNING] pid 0 or -1 could reach process.kill (range 2..2^22)
[WARNING] check-then-act gap before the signal (exclusions re-checked)

## Iteration 6 (Opus)
[WARNING] a test sent SIGTERM to a made-up pid, a live process on Linux CI (stand-in kill)
[WARNING] the real-ps test failed rather than skipped under a subreaper (skips)

## Iteration 7 (Sonnet)
[WARNING] the bystander arm could not fail (kill recorder)
[WARNING] the gated read stopped noticing foreign writers once the child's list was kept (reads first)

## Iteration 9 (Sonnet)
[WARNING] no test pinned "no second TERM inside the minute" (pinned)
[WARNING] a failed ps had no backoff (15 s)

## Iteration 10 (Opus)
[WARNING] a request forwarded while an orphan was being ended was trusted with the child's list (refused now)

## Final ledger (iteration 11, Sonnet): no WARNING, converged
[NIT] a verdict did not expire with its record (cleared on expiry)
[NIT] early returns set no verdict (an out-of-range pid is left alone; a pid-1 board refuses, stated)
[NIT] a kill that throws kept an "ended" verdict with no log line (left alone, logged)
[NIT] a separately supervised tunnel with this board's exact status-file path reads as an orphan (stated)
[NIT] the range arm's kill assertion could not fail (stand-in now returns an orphan line)
[NIT] the non-array arm covered only a string (an array of non-strings added)
[STRENGTH] the signal path is fenced by independent fail-closed conditions, each with a test that can fail
[STRENGTH] connectorCapabilities only narrows; a status file cannot widen a binary that says no

## After convergence (2026-10-21T08:33:06Z): main merged in, one guard line
The relay half (kosmos-relay #523) merged, so this PR came out of draft. Main (285 commits behind) was merged in
cleanly, and the full suite was run on that tree with tools/run-tests.sh: 22,819 tests, 4 red. Three were contention
(supervisor.codexhook-5812, supervisor.qwen-endpoint-5977, supervisor.retire-token-4530: each green alone). The fourth
was real and this branch's: engine/windows-tests-1777's guard, because the R01c arm in server.remotestepup-6595.test.js
skips on win32 and the file was in neither list. It is now in HOST_BRANCH_EXCLUDED with its reason (the arm reads the
process table with ps), and the guard passes (23/23). No product code changed after convergence.
