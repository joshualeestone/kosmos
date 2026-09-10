# Plan: served-verify-route (kosmos#2565)

## The gap
`served_verify_host_discriminates` in `tools/lib/served-verify.sh` builds its negative
control under one hardcoded route: `${host}/dist/<nonexistent>`. `tools/deploy-site.sh` runs
it once and, on a pass, trusts the host's 200s for EVERY asset it then checks -- including
`$HOST/setup`, which is at the site ROOT, not under `/dist`. So a host that discriminates
under `/dist` but is blind at the root (a catch-all / rewrite / SPA fallback scoped to a path
prefix) passes the control and is then trusted for `/setup`, where a 200 means nothing. This
is the "a control proves only the arm you aim it at" defect in a verdict-bearing check.

## The fix (option (a) from the card, backward-compatibly)
- `served_verify_host_discriminates <host> [route-prefix]`: `route-prefix` defaults to `/dist`
  (so every existing caller is byte-for-byte unchanged), trailing slash stripped so `/` probes
  the root (`$HOST/__...`). The caller aims the control at the route it is about to trust.
- `deploy-site.sh`: before trusting `$HOST/setup`, add a second control call
  `served_verify_host_discriminates "$HOST" "/"` proving the ROOT route discriminates. The
  existing default (/dist) call still guards the /dist assets (latest.json, the Windows zip).

## Why not the alternatives
- Card's option (b), "run the control a second time for /setup" by hardcoding a second probe
  in deploy-site: parameterizing is the same request count but gives the guarantee a name and
  lets any caller aim it, rather than duplicating the probe shape.
- Not shortening a cadence / not a content-type-only guard: `served_verify_asset_ok` already
  content-type-checks /setup (an html SSO page is rejected), but that does not catch a
  catch-all serving a NON-html 200 for every root path; the discrimination control does.

## Test (test-served-verify.sh, red-capable)
New `/routeblind` fixture: discriminates under /dist (a nonexistent /dist path 404s) but is
blind at the root (200 for every root path). Four new arms:
- sound host passes the ROOT-route control (rc 0) -- the root probe is a real control, not
  always-red (no false-red of a sound host).
- the route-blind host PASSES the default /dist control (rc 0) -- reproduces the gap.
- the route-blind host is CAUGHT by the ROOT-route control (rc 1) -- the fix returns the
  dangerous answer.
- a leading-slash-less route ('dist') is normalised to '/dist' (rc 0), red-capable: without
  the normalisation the malformed probe falls into the blind-root branch (rc 1). (added iter-2)
The suite runs 14 arms total, all pass.

## Weakest premise (from the card, verified mine)
If every host this runs against serves /setup and /dist through the SAME route, the second
(root) probe is a wasted request per deploy. Accepted: one extra HTTP request on a deploy is
cheap next to a false-green certification of a not-served /setup, and the prod alias case the
card measured (#1667 SSO) is exactly the route-scoped shape this closes.

## Residual (raised in review, bounded rather than left)
The control proves discrimination for a route PREFIX (a nonexistent sibling under it), the
granularity real rewrites / catch-alls / SPA fallbacks use. It does NOT catch a blindness
scoped to an EXACT literal path (a rewrite of exactly `/setup` with no wildcard and no
catch-all): a sibling probe 404s correctly and the control passes. That case is unreachable by
ANY negative control in principle (nothing routes identically to an exact match, so there is
nothing to probe) and is largely covered from the other side -- served_verify_asset_ok rejects
a 200 carrying text/html, the usual exact-route rewrite target -- leaving only a non-html
exact-route rewrite of the one path, a shape this infra does not produce. Documented in the
lib comment too.

## Only caller affected
`deploy-site.sh` is the sole runtime caller of the function (grep-verified repo-wide); the
default-route param keeps it and any future caller unchanged unless they opt into a route.

## Raised in review, dispositioned
- WARNING (operational): the new root control is a live fail-closed gate addition -- deploys now
  also require the site root to discriminate. INTENDED: a soft-404 root makes a /setup 200
  unverifiable, so refusing is correct, not a false-refuse. Documented in the deploy-site comment.
- NIT (robustness): the route param now normalises a missing leading slash (a caller passing
  `setup` no longer yields a malformed `${host}setup/...`); no-op for the `/dist` and `/` callers.
- NIT (coverage boundary, DEFERRED): the test drives the lib function directly; deploy-site's root
  call site (like its sibling 328/329/335 calls) is not unit-covered, so reverting only that one
  line would pass the suite. Accepted as consistent with the existing untested deploy-site
  orchestration, which runs against real infra; the load-bearing logic (the control itself) IS
  covered red-capably.

## Validate
served-verify suite (14 arms, all pass), full node suite + test:shell. Challenge-loop, proof, 6j, PR.
