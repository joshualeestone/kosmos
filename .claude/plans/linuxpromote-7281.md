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

## Review 3 (23:4x): 0 blockers, 1 warning (test only), 2 nits. CONVERGED.
- Checked clean: the trap's remedy never prints on success or twice; it cannot change the exit code (cleanup returns
  0, every exit between the commit and the end check is exit 1); the read-back branch clears TMP so the trap keeps the
  real latest-linux.json; the key-list temp is in the trap.
- WARNING FIXED (test): the stub's verify-under-list never opened the list, so the control proved the fetch, not that
  the COMMITTED list was read. Now the stub refuses a missing list and needs the committed signature; the working
  tree's copy disagrees with origin; the served list moves from another clone, so only a real fetch passes; a reachable
  origin with no list refuses. Mutants: read the working tree, skip the fetch: both red.
- NITs FIXED: the read-back failure is tested (owed, no temp, the real file kept); its message says to commit.
Test: 45 checks.

## Rebased onto main after C1 merged (2026-10-27 03:4x, Baron)
- `git rebase --onto origin/main 3fc9ccc55c`: 10 commits, clean. test:shell gains tools/test-promote-linux-7281.sh
  (688d036392). Rerun: promote 45/0, release 67/0, deploy 44/0, every-test-runs + all-node-tests-considered 6/6.
- NOT YET CONVERGED by the loop's own rule: review 3 still fixed a WARNING, so a 4th blind pass on the rebased diff is
  owed before the proof file. Queued behind buildver-7281's loop (one reviewer at a time).

## Review 4 (04:2x 10-27, sonnet, on the rebased diff): 0 blockers, 4 warnings, 5 nits
- W1 FIXED: the named-promote refusal now also says how to roll prod back by hand (restore both pointers from one
  earlier commit; the versioned files are never replaced). Rollback BY NAME stays a follow-up.
- W2 FIXED: a prod latest-linux.json that exists but names no manifest refuses instead of skipping verify-under.
- W3 FIXED: promote_linux_unchanged re-checks the tarball's sha256 and the manifest's signature right before the writes
  (the gates can queue for a long time), not only the pointer.
- W4 FIXED: the header says the two renames are not atomic and gives the remedy for a kill between them.
- Mutants: removing each fix reds its test (w1 49/1, w2 49/1, w3 48/2). Test: 50 checks.
- RECORDED (nits): a Linux pointer older than prod is guarded only by the Mac gate (the pair names one version);
  symlinked pointer files are followed (trusted local checkout, as the Mac path); latest-linux.json lands 0600 as
  latest.json does; the promote-channel.sh wiring is checked by greps and order, not a driven promote.
- The CONVENTION note (C3 must merge with or before this) is met: C3 merged 02:07 (e40f95e4d).

## Review 5 (04:3x 10-27, opus): 0 blockers, 3 warnings, 4 nits, 1 convention
- W1 FIXED: a named promote (--version, kosmos#7005) no longer refuses once staging publishes the Linux family; it takes
  latest-linux-staging.json COMMITTED in the named commit (as it takes the Mac pointer), checks the versioned files in
  the working tree (never replaced), and skips the working-tree pointer compare in unchanged. promote-channel.sh hands
  prepare the commit (`${NAMED_VERSION:+$NAMED_COMMIT}`). Review 4's rollback-by-hand text is gone with the refusal.
- W2 FIXED: deploy_linux_carry (C3's lib) refuses a commit whose Mac pointer and Linux pointer of one channel name two
  versions (latest.json/latest-linux.json, latest-staging.json/latest-linux-staging.json), the backstop for a promote
  stopped between its renames or a commit of latest.json alone. Checked only where the Mac pointer is committed.
- W3 FIXED: a DRIVEN whole promote (copied promote-channel.sh + libs, signature and gates stubbed): both pointers move
  (rc 0); a Linux version skew refuses with nothing written; a Linux write that does not take still runs /setup, then
  refuses at the end. Mutant: drop promote_linux_commit -> 5 red.
- Mutants: deploy guard removed -> 2 red; named path reads the working tree -> 1 red each arm.
- RECORDED: field() leaks as a global function name (no other user); V is not format-checked here (the Mac pointer is
  trusted, and a space splits safely); the staging Linux pointer is read from the working tree uncommitted, as the Mac
  one; promote_linux_stage's failure branch has no test; no `bash -n` of the lib in test:shell (the test sources it).
- PROCESS SLIP: I edited this worktree while its validation ran; that run is discarded and re-run on the commit.

## Review 6 (04:3x 10-27, sonnet): 0 blockers, 4 warnings, 3 nits, 1 convention
- W1 FIXED: a DRIVEN named promote (--version 9.9.8 while staging names 9.9.9, each cut committing its own Linux pair):
  exits 0, latest.json 9.9.8, latest-linux.json equals the pointer committed with 9.9.8, staging untouched. Mutant
  (promote-channel.sh hands prepare no commit) -> 4 red, 3 of them the driven named checks.
- W2 DUPLICATE of review 4 W4 (the two renames are not atomic): documented in the lib header, backstopped by the deploy
  lockstep refusal from review 5.
- W3 FIXED (comment): the named path's comment now says what makes it safe, the working-tree files must hash to the
  committed pointer's sha256, rather than asserting they are never replaced.
- W4 FIXED: the deploy guard reads the Mac pointer's version as JSON (node), not with a greedy sed. 47/47.
- DEFERRED (convention): review-round labels in comments; this repo's code carries them throughout (release-linux.sh,
  browser-checks.sh), so they are kept for consistency.
- NITs RECORDED: the owed e2e drives the read-back arm (the rename arm is unit-tested); field() global name; the
  commit-both hint prints only on success (the remedy prints on failure).

## Review 7 (05:0x 10-27, opus): 0 blockers, 3 warnings, 4 nits
- W1 FIXED: after a named promote, every failure remedy writes the pointer COMMITTED with it
  (`git show <commit>:dist/latest-linux-staging.json > dist/latest-linux.json`), not the staging file, which has
  usually moved on (copying it would split the pair). PROMOTE_LINUX_RESTORE carries the right one. Mutant -> 2 red.
- W2 FIXED: a rollback promote (--allow-older) with a Linux pair prints that the deploy needs KOSMOS_LINUX_ROLLBACK=<V>
  (deploy-site refuses a Linux pointer that moves backwards without it).
- W3 FIXED (message) + KNOWN LIMIT: a named rollback to a build cut before the first Linux build is refused (no Linux
  pointer to pair with); the refusal now says to roll back to a build that has a Linux build, and that deleting
  latest-linux.json is no way round it (installed Linux copies refuse to update on an unreadable pointer).
- NITs RECORDED: `shasum -c` checks the file the sidecar names (the sha is then compared to the pointer's, as the Mac
  path); the named path's verify-under reads prod's Linux pointer from the working tree, the Mac named path from
  origin/main; field() global name; the deploy check is skipped when no Mac pointer is committed (deliberate: test
  sites, and a real site always commits latest.json).
- Test: 73 checks.
