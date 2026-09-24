# deploy-site: verify the Windows zip users actually get (#3600)

## Problem

`tools/deploy-site.sh --promote` (and `--publish`) exits 1 on every Mac deploy while prod is
correct. The post-deploy served-verify checks the Windows zip named by the site's COMMITTED
`dist/latest-win.json`. Prod does not serve that file: `vercel.json` redirects
`/dist/latest-win.json` (307) to R2, and a Windows promote updates R2 without a site commit. On
2026-09-24 the committed pointer said 0.6.72, R2 said 0.6.89, 0.6.72 is not in R2, so the verify
404'd on a zip nobody is pointed at.

## Call

Post-deploy only: measure whether `$HOST/dist/latest-win.json` is a redirect (curl without `-L`).
- Redirect: read the served pointer through it, verify the zip it names plus its `.sha256`, and
  require the served `.sha256` to equal the sha the served pointer advertises (the Windows updater
  fetches the sidecar first and refuses a mismatch), and the served zip BYTES to hash to it (the
  R2 zip is never hashed anywhere else; about 40 MB, about a second). Print a NOTE naming the stale committed build.
- Not a redirect: unchanged. git archive ships the committed pointer, so `$WINZIP` is what is served.
- `KOSMOS_WIN_ZIP` set: unchanged (operator escape hatch).

## Rejected

- Committing the R2 pointer (0.6.89) into the site (card option 2). `derive_committed_win_versioned`
  requires the named versioned zip to be committed in the site, and 0.6.89 is R2-only, so this
  makes the deploy REFUSE pre-deploy. It also drifts again at the next Windows promote.
- Parsing `vercel.json` to detect the redirect. That reads intent, not what is served; measuring
  the served response is the direct instrument.
- Dropping the Windows check from deploy-site. The Mac deploy should still prove Windows downloads
  work, since it redeploys the `vercel.json` that routes them.

## Weakest premise

That a redirect of `latest-win.json` means the served pointer is authoritative for which zip users
get. True for the current routing (the zip wildcards go to the same R2). If someone redirects the
pointer but serves zips statically, the served pointer could name a zip only R2 has; the verify
would still fetch it through the same host and fail loudly if it is not served, so the failure is
a refusal, not a false green.

## Staged Windows pointer (found in challenge iteration 1)

The zip wildcard redirect also sends the STAGED zip to R2. Live on 2026-09-24: the committed
`latest-win-staging.json` names 0.6.81, prod serves 0.6.89, and 0.6.81 404s through R2, so the staged
block would have kept every Mac deploy red after the prod fix. Call: a staging pointer whose version
is not newer than the prod Windows build users get is superseded. Warn and skip its zip and sidecar served-verify; the staging pointer is still
checked against the committed one (A12).
A newer staged build is still verified in full (the Windows box verifies it from the served copies).
Rejected: dropping the staged block (loses the real check for a pending staged build).
"Not newer" is judged against both the served and the committed prod build (iteration 11): right
after a Windows promote the staging pointer names the just-promoted build, and if R2 missed it,
judging only against R2 would verify it and exit red before the unpublished warning printed.
Weakest premise: that a NEWER staged build is reachable at all. Since the 09-23 wildcard redirect,
staged zips route to R2 and nothing in this repo uploads them (#3618), so a pending staged build
reds every Mac deploy. That predates this branch and is kept deliberately: an undownloadable staged
build is a real defect. #3618 owns the fix.

## Committed newer than served (found in challenge iteration 5)

If the site's committed Windows build is NEWER than what R2 serves, a Windows promote was committed
but never reached R2, so users do not have it. Call: a loud WARNING saying so, and verify what is
served; the Mac deploy still exits 0. Rejected: refusing. The Mac deploy did its job, and failing it
on a pending Windows R2 upload is the red-as-noise failure #3600 exists to remove. Weakest premise:
nobody reads a warning on a green deploy. What would change my mind: a Windows promote flow that
deploys the site and uploads to R2 in one step, where a mismatch would then mean a real failure.

## Pre-deploy side, left alone

The pre-deploy committed-pointer vs committed-bytes agreement (#2571) still runs. It passes today
(0.6.72 is committed and agrees) and guards what git archive ships.

## Tests

`tools/test-deploy-site-served-win-3600.sh`, wired into `test:shell`. Twenty-four arms with a redirect-aware
curl stub: the card's shape (A1) with a control pinning the old semantics (A2), an unserved served
zip (A3), a pointer/sidecar disagreement (A4), the static path unchanged (A5) and its control (A6),
a superseded staged build skipped (A7), a newer served staged build verified (A8) and its control
(A9), a path-shaped served name (A10), a served pointer with no sha256 (A11), the staging-pointer
check kept for a superseded build (A12), a 500 probe falling back to the strict check (A13), a
wrong-shaped served name (A14), a redirect naming the committed build (A15), and the staged compare
using the KOSMOS_WIN_ZIP override's version (A16), a committed build newer than R2 flagged as
unpublished (A17), a status-less probe falling back strictly (A18), and the prod version read from the checked
name rather than a pointer's version field (A19), the same on the staged side (A20), and served
zip bytes that do not hash to the published sha (A21), and an unversioned committed name that
must not be called stale (A22), the post-promote R2-lag state reaching the warning (A23), and a superseded staged zip served
statically still verified (A24: the skip applies only when the staged zip itself redirects).
Red-capability: against origin/main's deploy-site.sh, A1 fails with the exact prod message.

## Status

- [x] fix + test, red-capability shown
- [x] full `yarn test` green at e4fd818d (8671 tests, 0 failed). That is an early commit; the final
  HEAD is validated by the challenge loop's closing gate, whose result and diff hash are in the proof
  file, not here
- [ ] challenge-loop, PR, merge
