# deploylanded-5471: step 8 checks whether the deploy landed before calling it a failure

Card: #5471. Branch: deploylanded-5471. Owner: Baron Draxum (Splinter 05:38 10-07: land before the 0.7.28 cut).

## Why
`vercel deploy --prod --yes` exited non-zero ("Error: fetch failed") at step 8 of 0.7.26 and 0.7.27 after
the upload had finished; Vercel completed both builds and they went live about a minute later. release.sh
ran it under `set -e`, so the cut exited 1. Its trap then deleted the "never served" tarball, steps 9+
did not run, and the operator had to verify by hand while resisting a revert or a re-cut.

## Decided
- **The served host decides, not the CLI.** On a non-zero exit, step 8 runs `site_deploy_landed`
  (tools/lib/site-deploy.sh) around `_deploy_landed_check`, which needs BOTH:
  1. `site_deploy_serves_this_build`: the served kosmos-$V-arm64.tar.gz.sha256 equals the one this cut
     wrote. Only this cut's upload can serve it; an earlier attempt at the same version passes a pointer
     check but not this (added in 477126687). Checked first, because it is one small fetch.
  2. step 9's verifier, tools/verify-served.sh, with this cut's pointer and installer, and the same HOST
     passed explicitly (a set-but-unexported HOST would otherwise split the two checks across hosts).
  Default 24 checks, 15 s apart (at least 6 min, plus each check's own fetches), overridable via
  KOSMOS_DEPLOY_LANDED_TRIES / _WAIT_S; a non-positive or non-numeric count is refused.
- **Landed:** say so, and continue as a successful deploy (DEPLOYED=1, steps 9+ run as normal).
- **Not seen landing:** exit with the CLI's own code, and say it may still land and how to measure before any revert or re-cut, and that the site checkout was restored (477126687 and the iteration-2 commit). DEPLOYED stays unset, so the trap restores the site and
  removes the never-served tarball, exactly as before.
- **CLI success:** unchanged; step 9 verifies as it always did.

## Rejected
- Polling `vercel inspect`: another CLI call that can fail the same way, and "Ready" is not "served at the
  edge". verify-served.sh measures what a user receives.
- Parsing the error text: the CLI's wording is not a contract.
- Retrying `vercel deploy`: a second production deploy of the same export, racing the first.

## Weakest premise
That a build which lands after the last check (beyond about 6 min) is rare. It is not handled automatically:
the cut fails as before, and its message tells the operator to measure before acting. Raising the
defaults trades a slower failure report on a real failure.

## Deferred
- A hung `curl` inside verify-served.sh (it sets no -m) can stall a check, so the 24-check bound is not a
  wall-clock bound. Not new: step 9 runs the same verifier the same way. The own-build fetch uses -m 30.

## Tests
`tools/test-deploy-landed-5471.sh`, in test:shell, 23 checks:
- the helper: passes on the 3rd check, never, at once; a non-positive or non-numeric count refused
- the own-build check: same sha, an earlier attempt's sha, nothing served, no local file; and the URL it
  fetches (<host>/dist/<name>.sha256)
- release.sh's real step-8 block, cut out of the file and run with `vercel`, `curl` and verify-served
  stubbed: landed continues to DEPLOYED=1, with the verifier asked about this channel on the same host;
  an earlier attempt's build fails without running the verifier; never served exits with the CLI's
  code, never sets DEPLOYED, and says it may still land; the CLI's code 7 is kept; CLI success asks
  nothing.
Measured red: the landed check disabled gives 5 failures; HOST not passed to the verifier gives 1.
