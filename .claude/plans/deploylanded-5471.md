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
  timestamps, tools/build-kosmos-bundle.sh). One small fetch, -m 30, per check, on the same HOST step 9 reads: one host serves every channel, and a
  staging cut differs only in its pointer file. Default 24 checks, 15 s
  apart (about 6 min), overridable via KOSMOS_DEPLOY_LANDED_TRIES / _WAIT_S.
- **Landed = the same position as a CLI success:** say so, set DEPLOYED=1, and let step 9 verify everything a
  user receives with its own retries. Review iteration 3 showed why the full verifier must NOT
  sit inside the landed check: a deploy that DID land but trips an unrelated verifier problem would be
  called "not served", and the trap would then restore the site and delete the local tarball while the
  host serves this cut's build. After a CLI success the same state reaches step 9's honest message instead.
- **Not seen landing:** exit with the CLI's own code; DEPLOYED stays unset, so the trap restores as before.
  The message says it may still land, prints THIS cut's sha (the trap is about to delete the local copy),
  names the served .sha256 URL to compare it with, says the checkout was restored, and that the trap's
  "never served" line means "not seen served".
- **Overrides are checked at step 1** (before anything is built or pushed) and again before deploying (`site_deploy_landed_args_ok`, numerically, so "00" is refused),
  so a typo stops the cut while nothing has been deployed.
- **CLI success:** unchanged; step 9 verifies as it always did.

## Rejected
- Polling `vercel inspect`: another CLI call that can fail the same way, and "Ready" is not "served at the
  edge".
- Parsing the error text: the CLI's wording is not a contract.
- Retrying `vercel deploy`: a second production deploy of the same export, racing the first.

## Weakest premises
1. That a build which lands after the last check (beyond about 6 min) is rare. It is not handled
   automatically: the cut fails as before, after printing this cut's sha and the URL to compare it with.
2. That no two builds share bytes (tools/build-kosmos-bundle.sh: codesign and tar/gzip timestamps). A cut
   that reused a previously built tarball without rebuilding would make an earlier attempt's served .sha256
   equal this cut's, and a failed deploy would read as landed. Step 9 then verifies the same served state,
   so the harm is bounded, but the "landed" line would be wrong. Likewise a manual tools/deploy-site.sh run
   between step 4 and step 8 would carry this cut's files from the shared site dist and serve its .sha256;
   that serves this very build, so "landed" would be true of the bytes but not of this cut's deploy.

## Also decided
- Before deploying, the cut prints this cut's sha and the .sha256 URL it will be served at, so the record
  is in the log however the cut ends (a Ctrl-C reaches release.sh's own INT trap too, and a failed cut's
  trap deletes the local copy). On a non-zero exit, a deploy stopped by an interrupt or terminate that
  reached vercel alone (130, 143) fails at once; a KILL (137, often out of memory) after the upload is
  the card's own case and is polled. A cut whose own .sha256 cannot be read fails at once.
- docs/releasing.md says what to do when it landed late: no revert or re-cut; run step 9's checks by hand
  from a checkout at the cut's version; FETCH THE SERVED TARBALL PAIR BACK into the site's dist/ (the
  trap deleted it, and promote-channel.sh refuses without it); refresh the tracked site files.
- The unversioned pair (kosmos-arm64.tar.gz) is prod's build and a staging cut leaves it as served; only a
  prod-channel late landing needs it fetched back (docs). Deferred: the trap's "never served it" lines still
  print after the not-seen message; the message explains how to read them, and moving them means changing
  the shared trap in release-freeze.sh for one case.
- docs/staging-channel.md's manual promote recipe has its own `vercel deploy` under `set -e`; it is a
  different path (an operator watching it), left as is.

## Tests
`tools/test-deploy-landed-5471.sh`, in test:shell:
- the helper: passes on the 3rd check, never, at once; a count of 0, 00, empty, x3 or 12345 refused, and a
  wait of x, empty or 12345
- the own-build check: same sha, an earlier attempt's sha, nothing served, no local file; the URL it
  fetches, with -f, -m 30 and the cache buster
- step 1 holds the override check before its fetch (a source-presence guard)
- release.sh's real step-8 block (step 8's override check to DEPLOYED=1), cut out of the file and run with
  `vercel` and `curl` stubbed (and a failing vercel first on PATH): the sha and URL are printed before
  vercel runs; served from the 2nd check continues to DEPLOYED=1 after exactly 2 fetches and never runs
  the full verifier; an earlier attempt's build fails; nothing served exits with the CLI's code (7 kept),
  never sets DEPLOYED, asks exactly 3 times and says it may still land; 130 and 143 fail without polling;
  137 is polled and a landed build continues; an unreadable own .sha256 fails without polling; a mistyped
  override is refused before vercel runs, naming the variable and range; CLI success asks nothing.
Measured red: the landed check disabled gives 4 failures; the own-build check accepting any served
.sha256 gives 3 (the earlier-attempt arms).
