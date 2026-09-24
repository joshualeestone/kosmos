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
  fetches the sidecar first and refuses a mismatch). Print a NOTE naming the stale committed build.
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
is not newer than the prod Windows build users get is superseded. Warn and skip its served-verify.
A newer staged build is still verified in full (the Windows box verifies it from the served copies).
Rejected: dropping the staged block (loses the real check for a pending staged build).

## Pre-deploy side, left alone

The pre-deploy committed-pointer vs committed-bytes agreement (#2571) still runs. It passes today
(0.6.72 is committed and agrees) and guards what git archive ships.

## Tests

`tools/test-deploy-site-served-win-3600.sh`, wired into `test:shell`. Eleven arms with a redirect-aware
curl stub: the card's shape (A1) with a control pinning the old semantics (A2), an unserved served
zip (A3), a pointer/sidecar disagreement (A4), the static path unchanged (A5) and its control (A6),
a superseded staged build skipped (A7), a newer served staged build verified (A8) and its control
(A9), a path-shaped served name (A10), and a served pointer with no sha256 (A11).
Red-capability: against origin/main's deploy-site.sh, A1 fails with the exact prod message.

## Status

- [x] fix + test, red-capability shown
- [ ] full `yarn test`
- [ ] challenge-loop, PR, merge
