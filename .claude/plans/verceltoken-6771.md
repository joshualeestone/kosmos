# verceltoken-6771: the site autodeploy deploys with a scoped Vercel token, and says so when it has none (kosmos#6771)

## Problem (from the card)
The Mortals site autodeploy (chaoskosmos-site site-deploy.yml, run 39509940414, 10-20 17:43 CDT) built a correct export
and then failed at `vercel deploy --prod` with a bare "Error: Not authorized": the CLI there ran on an interactive
sign-in that no longer authorizes the chaoskosmos project. Fix decided by Splinter (17:46): a scoped project token,
filed with /add-secret on Mortals, used as VERCEL_TOKEN; refuse clearly when it is missing.

## Change
1. `tools/site-autodeploy.sh`: just before the deploy, VERCEL_TOKEN is taken from the environment if set (that wins),
   else from the secrets map (`secrets-map.sh value vercel-chaoskosmos-site`; target and command overridable). The CLI
   reads VERCEL_TOKEN from the environment (checked in its own code, `tokenSource = "env"`), so the token is never on a
   command line; in GitHub Actions it is also masked (`::add-mask::`) as soon as it is read. Each cause is its own red,
   once a day and keyed on no sha (a new merge does not re-red it), with nothing deployed, no failure counted and no
   park: no accessor (nosecrets), no token (notoken, with the accessor's own reason), and deploy-site.sh's exit 77, the
   CLI refusing the authorization (vercelauth). So filing or replacing the token is the whole fix: the next tick deploys.
2. `tools/deploy-site.sh`: when its output is not a terminal (the autodeploy, a cut over ssh) the CLI's output also
   goes to a temp file; a refusal on the CLI's own `Error:` line (colour codes removed) is said in full, no token given
   (file one / sign the CLI in) or the token refused (make a new one; an inherited VERCEL_TOKEN wins over the map), and
   exits 77. Any other failure is exit 1 with its own code. At a terminal the CLI runs exactly as before.
3. Tests: `test-site-autodeploy-5589.sh` (the #6771 arms: no token red then STILL FAILING, a new merge still green,
   the secrets target asked for, a filed token used, an inherited token wins, no accessor, the accessor's reason, the
   Actions mask, nothing printed outside Actions, exit 77 never parks and the next good tick deploys) and
   `test-deploy-site-exit0-2791.sh` (B5, B5c, B5t, B6, B7, B8: both refusal messages and exit 77, a coloured error line,
   the CLI's real refused-token wording, a non-authorization failure with no token sentence, the token not in
   deploy-site's own lines, and the vercel command receiving the token).
4. The token's reach: the autodeploy exports it, and deploy-site.sh takes it out of its environment at the start and
   gives it to the `vercel` command alone, so the site build and the fetches never see it.

## A cost, stated

While the token is missing or refused, every tick still builds the export before it is refused at the deploy step
(as exit 75 already retries): the red is once a day, the work is every tick. Filing the token ends it.

## Not covered: release cuts

A release cut's step 8 runs `vercel deploy --prod --yes` itself (tools/release.sh), not through deploy-site.sh, so a
cut on Mortals still uses that machine's CLI sign-in. Measured 19:05 on 10-20: the CLI there is signed in and lists the
chaoskosmos project's deployments from the cut's site checkout, so cuts are not affected tonight. The autodeploy's
failure is then most likely its runner's environment (no CLI sign-in where the job runs), not the account: not
measured. Giving cuts the same token is a follow-up if wanted.

## Already parked on Mortals?
The 10-20 "Not authorized" runs failed with exit 1 under the old code, so the current site sha may be parked there.
After the token is filed: remove `~/.kosmos-site-autodeploy/parked` on Mortals once (or merge any site change).

## Not done here, and whose
The token itself: made by a person in the Vercel dashboard (on Josh's list), then filed on Mortals with
`/add-secret` as target vercel-chaoskosmos-site. Until then the autodeploy is red once a day with that instruction,
and site deploys go from Agent1s.

## Weakest premise
That Mortals' CLI (59.11.7) reads VERCEL_TOKEN the way this Mac's (50.25.6) does. Checked here only; the first real
autodeploy run after the token is filed is the proof, and a refusal there now says which of the two cases it is.
