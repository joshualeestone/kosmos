---
pre_challenge: true
method: challenge-loop
branch: site-commit-568
diff_hash: e0a5a1b6e2bdb344516afa56ba4df8a4ea035b506fdebec66d9b0e6b81eee219
subdir_audit: passed
timestamp: 2026-08-24T17:10:40Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (bounded to one round in the plan, stated before the loop)
**Converged:** Yes (all findings fixed in place; the PM's independent question landed on the same line as the round's warnings)
**Total findings:** 8 (1 BLOCKER, 4 WARNINGs, 3 NITs)
**Fixed:** 8 | **Deferred:** 0

### The change

release.sh committed and pushed the app repo but only copied into the site
checkout, and Vercel deploys the working tree, so eleven releases'
installers served from nobody's history (#568): the swap-proof installer
that ended the 0.5.13 wedge was live and unrecorded, and the line-number
diagnostic that found that wedge is confounded while the served script
matches no revision. Now the release commits and pushes the site's four
tracked release files, by explicit path at every step, before deploying;
verify-served proves the SERVED /setup matches origin/main of the site.
The eleven-release backlog was committed by hand first (6778963), so the
check is true from its first run.

### Iteration 1 (bounded, final)
- [BLOCKER] git add was path-limited but the commit took the WHOLE index:
  anything somebody had staged in the shared checkout would have ridden
  a release commit to origin/main unseen --> FIXED: the diff test and
  the commit name the four paths; other staged work stays staged
- [WARNING] both sides of the history comparison hashed empty stdin on
  failure and agreed with each other --> FIXED: files, fetched and
  non-empty, or the line fails
- [WARNING] a swallowed fetch made a stale origin/main indistinguishable
  from fresh --> FIXED: said in the sentence
- [WARNING] SITE and KOSMOS_SITE could point at different checkouts and
  a missing checkout skipped the check silently --> FIXED: one
  resolution, release.sh passes it, and a missing checkout FAILS the cut
- [WARNING] the push-rejected branch under-told the recovery --> FIXED:
  rebase, push, re-run, expect the bump the immutable versioned name
  forces
- [PM question, same line] the history check read /setup through the
  same edge that served stale bytes and could cry wolf on a good release
  --> FIXED: it fetches with the updater's own ?v=<version> buster and
  measures what an updating machine runs; check_bytes keeps the plain
  URL because that is what the marketing line runs; the six-read retry
  covers edge lag on both
- [NIT] pushing others' unpushed commits is now stated; [NIT] the
  redundant cat is gone; [NIT] the double fetch is now one busted fetch
  for history and one plain for bytes, each measuring its own audience

### Validation
Full suite green (validation-log PASSED), subdir audit passed, both
scripts parse, and verify-served run live against the release host
reports the served /setup matches origin/main of the site. No em dashes
in any added line.
