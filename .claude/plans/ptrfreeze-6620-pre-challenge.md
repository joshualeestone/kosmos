---
pre_challenge: true
method: challenge-loop
branch: ptrfreeze-6620
diff_hash: d3e78ac258b65fe8c519522eb489d4c3b62469c2a8b18d1814c1504bc92b0647
validation: passed (Mortals, full suite, on the tree merged with main at 3a5ed822d3, 2026-10-22T16:59:03Z)
timestamp: 2026-10-22T16:59:56Z
iterations: 19
converged: true
---

# Challenge-loop proof: ptrfreeze-6620 (kosmos#6620 part 3: freeze the release pointers at a known-good build)

**Iterations:** 19, alternating sonnet and opus. **Converged:** yes, at iteration 19 (no new BLOCKER, WARNING or
CONVENTION; four NITs, below). The per-round findings and what was done with each are in
.claude/plans/ptrfreeze-6620.md under its review notes (rounds 1 to 18), which this proof does not repeat.

Iteration 12 had converged once; a merge of main then turned tools.cut-home-2724.test.js red (the freeze lib's probes
printed into a fake git's output), which reopened the loop, and rounds 13 to 18 each found real gaps, all fixed with
arms measured against the pre-fix code: the pre-deploy re-check had no test that ran it; a stale freeze in a checkout
could answer for a newer one on origin; a hand commit on top of the pin (another pointer, an installer) would ship
under it, and twice that deployed against the old code; the late re-check compared only the Mac pointers; a later
marker edit could hide a move; refusal advice was chosen by where the freeze was read (so it said "pull" when pulling
changes nothing, and once offered to lift the freeze); the Windows site pointers could not be pinned the way the tool
said.

## Iteration 19 (sonnet): NITs only
- [NIT] the late re-check says "could not fetch origin/main" on a site with no origin --> DEFERRED (harmless wording; the
  early check already treats no origin as a normal case)
- [NIT] a stale checkout that has not pulled a lift names the old freeze in a refusal --> DEFERRED (the refusal already
  says to pull if it was lifted; freeze_advice says "lifted" when origin/main is read)
- [NIT] the writer CONTROL arms can pass because a sandboxed writer dies at an earlier guard --> DEFERRED (as round 18:
  the frozen arms match each writer's own FROZEN message, which is the real coverage)
- [NIT] the lib header's note on local --> no change needed

## Decided and left (with reasons, from the rounds)
- The late re-checks just before vercel go on when their fetch fails (round 3): a flaky network should not abort a
  built deploy; the early check failed closed minutes before.
- A missing perl reads as a fetch failure (round 13): it fails closed.
- A Ctrl-C can leave the temporary index directory in TMPDIR (round 15): small, harmless.
- Not covered by this tool, and said in its output and the docs: Windows prod on R2, Kosmos.pkg, a Vercel Instant
  Rollback, and a freeze landing while vercel uploads.

## After convergence (2026-10-21T07:14:35Z): one test-only change
Hosted CI (GitHub macOS, switched to at 01:45 CDT) failed seven #6620 arms in tools/test-deploy-site-promote.sh: that
runner's git defaults to the branch name master, so each test's bare origin had a HEAD naming a branch never pushed,
and every clone of it checked out nothing. The fix creates each bare origin with --initial-branch=main (9 sites, the
whole file). Reproduced locally with init.defaultBranch=master: 7 red before, 81/81 after; 81/81 under main too. No
product code changed, so no review round was run for it; the diff_hash above covers it.
Second test-only change (2026-10-21T11:55:45Z): the hosted run then failed four arms of tools/test-pointer-freeze.sh for the same reason
(reproduced with init.defaultBranch=master: 4 red; 0 after, under both defaults). Its bare origin, and
tools/test-deploy-landed-5471.sh's, now start on main. A sweep of every test file this branch touches finds no other
unpinned bare origin. No product code changed; the diff_hash above covers it.
Main merged in (2026-10-21T12:28:55Z): the PR conflicted with main (#6771's token-aware vercel deploy and #6738's served-versions
table), so GitHub ran no CI for 52cb2b8fe2. Resolved by keeping both sides: package.json's test:shell line is main's
with this branch's pointer-freeze entries re-inserted (checked that those were the only differences); deploy-site.sh
keeps the late freeze re-check and then main's new deploy block in place of the old one-line vercel call;
site-deploy.sh removes the freeze marker and then writes main's served-versions table. On the merged tree: nine
site-deploy shell tests green (export, served-versions, pointer-freeze, promote, deploy-landed, autodeploy, push-race,
fetch, staged-mac) and the full node suite, 22,875 tests, 0 failed.

Main merged in again (2026-10-21T18:48:09Z): package.json's test:shell line conflicted (main added the tar-macmeta and managed-sandbox-lock tests). Resolved with main's line plus this branch's four pointer-freeze entries re-inserted after test-site-restore-1548.sh; package.json was the only file both sides changed since the last merge. Also covered by this hash: d4936594d5 (test-pointer-freeze runs release.sh with a sandboxed TMPDIR, the hosted-CI red; mutant red). On the merged tree: syntax checks on the lib (bash and sh) and tools/test-pointer-freeze.sh ALL PASS.
