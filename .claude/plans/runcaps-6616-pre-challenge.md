---
method: challenge-loop
branch: runcaps-6616
diff_hash: 0ab3acca09f097838da11ed53d6396fe34dac536109c00cd115f480355ee5319
timestamp: 2026-10-20T08:04:41Z
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
server.remotestepup-6595.test.js; with engine/remote.test.js and engine.reachable.test.js, 277 pass (three runs; one
earlier combined run had one unexplained red that did not recur).
