# Plan: #1667 - verification instruments go blind (200-for-everything), release-tooling slice

## Problem
kosmos#1667: a 200 only means a request SUCCEEDED, not that the asset you named exists. On this infra
a Vercel preview/deployment URL 302s to an SSO page that returns 200 (text/html) for EVERY path, so a
status-only HTTP check goes blind and would certify a broken deploy. Measured by April (a preview URL
served 200 + 341KB of HTML for a must-not-exist control) and reproduced by Splinter. The production
alias discriminates correctly (a nonexistent path 404s) and remains trustworthy - but that must be
PROVEN at runtime, not assumed, because the whole failure is a green that could not have been red.

The card names three instruments, each owned by someone else: the installer's reachable() (Kitty),
deployment URLs (Angel/Renet), preview URLs (April). This branch is the RELEASE-TOOLING slice.

## Scope (mine) and decision
Audited the release-tooling HTTP verification instruments (deploy-site.sh, release.sh, live-sweep.sh):
- release.sh: verifies the prod alias with `-f` (catches 404) and compares the SERVED tarball by
  content. Sound.
- live-sweep.sh: not an HTTP checker (no curl verification). N/A.
- deploy-site.sh: `served_matches()` compares each gitignored artifact by SHA (content) - strong. But
  `served_200()` was STATUS-ONLY (http_code==200, with -L) for the Windows zip and /setup, and there
  was NO negative control proving the host discriminates. That is the exact "/setup second door" the
  card names: a 200 that does not prove the thing it names.

Decision (mine, reversible): extract a small sourceable lib `tools/lib/served-verify.sh` with two
functions implementing the card's two tells, and use them in deploy-site.sh in place of `served_200`:
- `served_verify_host_discriminates HOST` - fetches a path that cannot exist and REFUSES if it does
  not 404 (the negative control: prove the host discriminates before trusting any 200).
- `served_verify_asset_ok URL LABEL` - requires a 200 AND a content-type that is not text/html (an
  html page wearing a success code).
The functions RETURN non-zero and print the reason; the caller decides to exit. That is what makes the
same code testable against a server in the blind state.

Rejected: (1) inline the checks in deploy-site.sh only - works, but the card wants this pattern to
spread to the other instruments, and an inline check cannot be unit-tested against a blind host
without testing a copy. A lib is the repo convention (every guard is a lib + a test). (2) a full
parser/rewrite of every instrument across lanes - out of one agent's scope; the three named
instruments are others'. I route those instead.

Weakest premise: deploy-site.sh verifies the prod alias ($HOST=installkosmos.com), which today
discriminates, so the negative control passes today and the hardening is latent until the infra
shifts (e.g. $HOST ever pointed at a deployment URL). That is acceptable - the guard's value is
exactly that it would REFUSE rather than certify blind if that shift happened, and it costs one extra
HTTP request per deploy.

## Change
- New: tools/lib/served-verify.sh (the two functions, POSIX sh, return-code based).
- New: tools/test-served-verify.sh (hermetic: a local python3 server with a discriminating behaviour
  and a blind SSO-200-for-everything behaviour; sources the SAME lib deploy-site.sh sources; positive
  arms pass, and the two RED-CAPABLE arms confirm the blind host and an html-200 asset are caught).
- deploy-site.sh: source the lib; replace `served_200` with served_verify_host_discriminates +
  served_verify_asset_ok.
- package.json test:shell: wire `bash -n tools/lib/served-verify.sh && bash tools/test-served-verify.sh`.

## Verification
- test-served-verify.sh: PASS, red-capability proven (blind-host arm rc=1, html-200 arm rc=1).
- Meta-guards: tools.every-test-runs.test.js PASS (the new test is executed, not just mentioned);
  test-zsh-tied-names.sh PASS.
- Empirical on the live prod alias: tarball application/gzip 200, /setup text/plain 200, a nonsense
  path 404 (the negative control returns the discriminating answer).
- Full test:shell: green except test-browser-run-guard.sh, which fails on ENVIRONMENTAL contention (a
  concurrent `bash tools/browser-checks.sh`, pid 36115, on the shared Mac) - reproduced identically on
  the clean main checkout, so not this change; CI runs on a clean runner.

## Review dispositions
- iter1 WARNING (case-sensitive html match): FIXED (lowercase before matching; new red-capable arm).
  iter1 NITs (empty content-type accepted, no curl timeouts, no [ -f ] source guard): all FIXED.
- iter2 CONVENTION (tr A-Z range form is locale-fragile): FIXED (tr '[:upper:]' '[:lower:]', the
  newer lib convention). iter2 NIT (terse caller messages): improved.
- iter2 WARNING (the negative control couples on the prod alias 404-ing unknown /dist paths; a future
  Vercel SPA catch-all / rewrite that 200s unknown paths would make every deploy refuse here):
  DEFERRED as acceptable-by-design. This is the feature, not a bug: if the prod alias ever started
  200-ing unknown /dist paths, the discrimination the WHOLE served-verify relies on would be broken,
  and a verification gate that REFUSES rather than certifies blind is exactly right. It runs after
  `vercel deploy --prod`, so a false refusal triggers investigation, never state corruption, and the
  message names the #1667 shape so the cause is obvious. The coupling is recorded here so it is known.

## Routing (the non-release instruments, to their owners)
- Installer reachable() accepts 206 (dead "could not reach" message) -> Ice Cream Kitty (installer).
- Deployment-URL checks read blind (302 for subject and control) -> Angel/Renet.
- Preview-URL checks 200 for a must-not-exist control -> April.
The new lib is available for them to adopt (it is host-agnostic).
