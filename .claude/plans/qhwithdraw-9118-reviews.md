# qhwithdraw-9118 review record (kosmos#9118 slice A2: queued-heavy.sh --withdraw "<what>" [--all])

Stacked on qhgroup-9118 (A1). Every round a fresh blind reviewer; each fix landed with an arm shown red on the previous
round's script before it counted.

- Round 1 (2870b4d4b1): 0 B, 2 MAJOR, 5 MINOR. A foreground holder reported withdrawn while its command ran on unclaimed
  (-> label records state; fg refused, exit 4). A pid known only by a command-line substring, so a reused pid (a renewer,
  a watcher) could be signalled (-> label records the start time; signal only on a match). Minors: EPERM read as gone,
  zombie counted alive, take window, test precondition, seam. All fixed.
- Round 2 (8ed6c7e2ce): 0 B, 1 MAJOR, 5 MINOR. A run turning fg between the read and the TERM (-> fg holder records
  TERM/HUP; bash defers until the command ends). Take lock left by a TERM; Linux lstart can drift 1 s (-> /proc start
  ticks); exit 5 for unverifiable. Fixed.
- Round 3 (a0e954a7db): 0 B, 1 MAJOR (design), 4 MINOR. Free-text labels on a shared Mac: several matches were all
  TERMed (-> refused, exit 6, unless --all). Empty live reads; fg trap replaced the rc with 143 (-> record only); wait
  bound vs grace (-> label line 4). Fixed.
- Round 4 (ae81c42492): 0 B, 1 MAJOR, 4 MINOR. The --all count left out a fg twin, so a colleague's bg run went (-> every
  live match counts). .tmp cleanup never worked; vanishing label read as unreadable. Fixed.
- Round 5 (1d86a2d1fe): 0 B, 0 MAJOR, 4 MINOR. ps-read race; fg turn during the wait; fg ALRM/USR; side fork guard.
  Fixed. Design limit stated: a single live match may be a colleague's run with your label.
- Round 6 (b1a88d1bca): 0 B, 0 MAJOR, 5 MINOR. Side fork guard lacked ALRM/USR (fixed); "withdrew 0" (fixed). Accepted:
  rollout (install the new copy before announcing --withdraw: the old copy queues "--withdraw" as a label); untested
  branches (exit 5 and usage probed by the reviewer); Linux fg arms unproven until CI.

Converged: rounds 5 and 6 found no BLOCKER or MAJOR.
