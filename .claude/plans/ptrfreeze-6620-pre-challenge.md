---
pre_challenge: true
method: challenge-loop
branch: ptrfreeze-6620
diff_hash: 41d298beef77aad151ff9f30891c7036c8e1a977345cbf33f22b3ac250cce706
validation: passed (tools/test-pointer-freeze.sh, test-deploy-site-promote.sh, test-deploy-landed-5471.sh, test-site-push-race-2276.sh all green; 49 more tools/test-*.sh that use the changed scripts green; node --test tools.*.test.js 1220 pass 0 fail; dash -n on the lib and deploy-site.sh; every new refusal arm also run against the pre-fix code; em-dash sweeps by every reviewer with a control)
timestamp: 2026-10-21T06:15:30Z
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
