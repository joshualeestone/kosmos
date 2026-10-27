# kosmos#7281 slice C2: a Mac promote moves the Linux pointer in lockstep (branch linuxpromote-7281)

Design: .claude/plans/linuxrelease-7281.md item 6 (stacked on that branch, slice C1).

## Built (2026-10-26 23:0x)
tools/lib/promote-linux.sh: prepare (before any gate or write: decide, snapshot latest-linux-staging.json, check its
version = V, its names, the tarball against its .sha256 and the pointer, the manifest signature), unchanged (right
before the writes), stage (before latest.json's rename), commit (one rename after it), refuse_if_failed (after the
alias), cleanup (EXIT trap). promote-channel.sh: the marker line `PROMOTE_MOVES_LINUX=1` that C1's prod guard reads,
`--family linux` refused, the calls. A named promote (--version) refuses while any Linux pointer exists (follow-up:
moving the Linux pointer by name is not built, so rollback by name waits for it). Prod with a Linux pointer but
staging without one refuses.

## Review 1 (23:1x): 0 blockers, 2 warnings, 4 nits
- W1 FIXED: a Linux write failure after latest.json exited before the #3940 log, /setup and the alias. Now the temp is
  staged and checked before latest.json moves, the commit is one rename, a failure is owed and refused at the end.
- W2 FIXED: the Linux manifest gets the Mac's verify-under (prod's current Linux release keys) and verify-under-list
  (#6609 served list) checks.
- NIT (merge order) RECORDED: the marker lifts prod Linux cuts before C3 (deploy carry) is in; C3 must merge with or
  before C2. NIT (named rollback impossible once Linux exists) RECORDED as a follow-up. NIT (snapshot leak in tests)
  FIXED. NIT (only the pointer re-checked before the writes) RECORDED (same as the Mac path).

## Review 2 (23:3x): 0 blockers, 2 warnings, 3 nits
- W1 FIXED: the key-list test passed with the check deleted (no origin, so the fetch refused first). Now a real bare
  origin carries the served list; a good signature passes with the check on, a LIST signature refuses, a missing
  origin refuses separately (mutant: delete verify-under-list -> red).
- W2 FIXED: the EXIT trap says the Linux remedy on any early exit after a failed rename (/setup or alias failures),
  unless the end check already said it (mutant red).
- NITs FIXED: the key-list temp folder is in the trap; the read-back failure is named apart from the rename failure.
  NIT RECORDED: manifest-sign.js maps a thrown error to 1 ("not signed"); still a refusal, wording only (Mac too).
Test: 41 checks.
