# cutleftover: an aborted cut's never-served files no longer stop the next cut of that version (kosmos#8562)

From Splinter 11-15 13:34 after the 0.8.05 Mac+Linux cut refused at step 4b (Baron's reasoning on #8527, 13:33).
Merge only after Baron lifts the current kosmos merge hold.

## Cause (measured in release.sh)
The versioned files (dist/kosmos-<V>-arm64.*, -linux-x64.*) are gitignored in the site checkout. The EXIT trap's
release_site_restore removes them only when this cut wrote them AND had not reached its deploy (`[ "$DEPLOYED" = 1 ]
|| release_site_restore`). The 11-13 attempt died at its deploy (vercel exited with no deployment), so its files
stayed, and today's cut refused at 4b, about two hours in.

## Call
New step 1g (tools/lib/release-leftovers.sh), before anything is built and before the trap reads _pair_had, for the
families this cut builds (arm64; linux-x64 when CUT_LINUX=yes):
- Step 8 records `kosmos-cut-served-<V>` in the site's .git once it has SEEN this cut's build served (kosmos#8494
  made that the only way step 8 finishes). If the marker is there, 1g refuses: bump the version. This is "ever
  served", so a version later reverted and pruned to 404 is still refused (review 1).
- No marker (the 11-13 leftovers predate it, or a cut killed before its trap ran): never served only if the
  version's own .sha256 answers exactly 404, a made-up version answers 404 too, and the prod pointer's version
  answers 200 with a checksum. A checksum: served, refuse. Anything else (5xx, timeout, a control that does not hold):
  unknown, refuse with the way on (review 1: a transient failure must never read as "never served").
- Never served but the site carries a COMMITTED Linux manifest for <V> (the dead attempt's 7b commit): refuse now,
  naming the commit to revert; release_linux_publish would refuse it at 4b otherwise (review 1).
- The marker is written in the clone's common git dir (`git rev-parse --git-common-dir`, resolved), so every worktree
  of one clone shares it, and a failure to write it is said, not swallowed (reviews 2 and 5).
- No age wait. Review 2 asked for one (a deploy may still land); review 5 showed a file's mtime is set at 4b, hours
  before any deploy, so the wait never covered the case it was for. Step 8's guard is the protection, and the runbook
  says so instead.
- Step 8 asks the host again just before vercel (release_leftovers_guard_deploy, each family this cut builds): if
  ANOTHER build of V is served now (a deploy still in flight when 1g read the host, or one that landed after its cut
  cleaned up and left no file), the cut does not deploy. 404 or this cut's own sha: go on; anything else after 3
  reads: refuse (review 3). It runs again before each vercel retry, beside the freeze check (review 5). This is the
  guard that protects the name; 1g only spares a cut the build.
- With no leftovers and no committed manifest, 1g does not read the host: a cut start must not depend on the
  production host, and the suite's nested cuts would read it too (a test cutting 0.7.50, a really served version, was
  refused when I tried it). The cost, taken on purpose: a version that landed after its cut cleaned up is refused by
  step 8's guard after the build, not at 1g (review 4 W1).
- A channel's first Linux cut has no Linux pointer; the Mac family's served version is the positive control (review 4).
- Every family is decided before anything moves; then the leftovers go into ONE dated folder beside the site
  checkout, outside git, nothing deleted. Tracked files are never touched; a git error is a refusal.

Rejected: deleting the leftovers (no undo); moving them inside dist/ (git status and clean-tree checks); judging by
the tarball's status alone (a 404 is only "never served" when a made-up name gets the same and a real one does not).

Weakest premise: the marker is per checkout. A later cut of the same version from ANOTHER clone that holds leftovers,
after the version was removed from the host, has no marker and sees a 404. What bounds it: dist-retention keeps the
newest 12 versions plus anything served or staged, so a recent version is not pruned; what is left is a Vercel
rollback or a hand removal (review 3 corrected my first reason, which named a step-1 guard that compares with the
checkout's package.json, not a served pointer). Also: a cut killed before step 8 recorded its marker but after its build went live (between the landing
check and the marker line, two lines apart) leaves no marker; the host probe then sees the served checksum and
refuses anyway, unless the version has since been pruned from the host.

## Also
- docs/releasing.md's failed-cut checklist: names step 1g and the marker, checks the .sha256 (status and body) against a
  made-up version, and says a 5xx or timeout proves nothing. (My first version of this said the host answers 200 for any
  name; review 1 measured 404, and so did I: corrected.)
- tools/test-setup-staging-5032.sh extracted step 1f up to step 2; it now ends at the next step marker (1g sits
  between). Still passes on main's release.sh.

## Tests
- tools/test-release-leftovers-8562.sh (37 arms, registered in package.json test:shell), with a curl stub that answers
  as installkosmos.com does (404 for unknown names). Mutations of the marker check, the strict 404, each control,
  decide-before-move, the Linux-manifest refusal, the tracked-file skip, the git-dir marker and the deploy
  guard (another sha, and its wiring) and the git-error refusal each red their arm. test-vercel-refusal-7711 pins the
  retry hook's new name. test-deploy-landed-5471 stubs the guard (it is about landing).
- Every test that reads release.sh or test:shell: node 246 pass; 46 shell tests pass after the 5032 fix.
