# deploylanded-5471: step 8 checks whether the deploy landed before calling it a failure

Card: #5471. Branch: deploylanded-5471. Owner: Baron Draxum (Splinter 05:38 10-07: land before the 0.7.28 cut).

## Why
`vercel deploy --prod --yes` exited non-zero ("Error: fetch failed") at step 8 of 0.7.26 and 0.7.27 after
the upload had finished; Vercel completed both builds and they went live about a minute later. release.sh
ran it under `set -e`, so the cut exited 1. Its trap then deleted the "never served" tarball, steps 9+
did not run, and the operator had to verify by hand while resisting a revert or a re-cut.

## Decided
- **The served host decides, not the CLI.** On a non-zero exit, step 8 asks `site_deploy_landed`
  (tools/lib/site-deploy.sh) whether `site_deploy_serves_this_build` passes: the served
  kosmos-$V-arm64.tar.gz.sha256 equals the one this cut wrote. Only this cut's upload can serve it (an
  earlier attempt at the same version passes a pointer check, never this; the bundle embeds build
  timestamps, tools/build-kosmos-bundle.sh). One small fetch, -m 30, per check. Default 24 checks, 15 s
  apart (about 6 min), overridable via KOSMOS_DEPLOY_LANDED_TRIES / _WAIT_S.
- **Landed = the same position as a CLI success:** say so, set DEPLOYED=1, and let step 9 verify everything a
  user receives with its own retries. Review iteration 3 showed why the full verifier must NOT
  sit inside the landed check: a deploy that DID land but trips an unrelated verifier problem would be
  called "not served", and the trap would then restore the site and delete the local tarball while the
  host serves this cut's build. After a CLI success the same state reaches step 9's honest message instead.
- **Not seen landing:** exit with the CLI's own code; DEPLOYED stays unset, so the trap restores as before.
  The message says it may still land, how to measure before any revert or re-cut, that the checkout was
  restored, and that the trap's "never served" line means "not seen served".
- **Overrides are checked before deploying** (`site_deploy_landed_args_ok`, numerically, so "00" is refused),
  so a typo stops the cut while nothing has been deployed.
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

## Tests
`tools/test-deploy-landed-5471.sh`, in test:shell, 25 checks:
- the helper: passes on the 3rd check, never, at once; a count of 0, 00, empty or x3 refused
- the own-build check: same sha, an earlier attempt's sha, nothing served, no local file; the URL it fetches
- release.sh's real step-8 block (override check to DEPLOYED=1), cut out of the file and run with `vercel`
  and `curl` stubbed: served from the 2nd check continues to DEPLOYED=1 after exactly 2 fetches of HOST's
  .sha256 and never runs the full verifier; an earlier attempt's build fails; nothing served exits with
  the CLI's code (7 kept), never sets DEPLOYED, asks exactly 3 times and says it may still land; a
  mistyped override is refused before vercel runs; CLI success asks nothing.
Measured red: the landed check disabled gives 4 failures; the own-build check accepting any served
.sha256 gives 3 (the earlier-attempt arms).
