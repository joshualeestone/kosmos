# verceltoken-6771: the site autodeploy deploys with a scoped Vercel token, and says so when it has none (kosmos#6771)

## Problem (from the card)
The Mortals site autodeploy (chaoskosmos-site site-deploy.yml, run 39509940414, 10-20 17:43 CDT) built a correct export
and then failed at `vercel deploy --prod` with a bare "Error: Not authorized": the CLI there ran on an interactive
sign-in that no longer authorizes the chaoskosmos project. Fix decided by Splinter (17:46): a scoped project token,
filed with /add-secret on Mortals, used as VERCEL_TOKEN; refuse clearly when it is missing.

## Change
1. `tools/site-autodeploy.sh`: just before the deploy, VERCEL_TOKEN is taken from the environment if set, else from the
   secrets map (`secrets-map.sh value vercel-chaoskosmos-site`; target and command overridable). With none: red once a
   day naming the secrets target, nothing deployed, no failure counted and no park, so filing the token is the whole
   fix and the next tick deploys. The CLI reads VERCEL_TOKEN from the environment (checked in its own code,
   `tokenSource = "env"`), so the token is never on a command line.
2. `tools/deploy-site.sh`: the deploy's output is kept (still shown as it runs) and a refusal for authorization is said
   in full: no token given (file one / sign the CLI in) or the token refused (make a new one). Nothing else about the
   deploy changes, and Agent1s keeps deploying with its signed-in CLI and no token.
3. Tests: `test-site-autodeploy-5589.sh` (5 arms: no token red then STILL FAILING, the secrets target asked for, a filed
   token used, an inherited token wins) and `test-deploy-site-exit0-2791.sh` (B5, B6: the two refusal messages, the
   token never printed).

## Not done here, and whose
The token itself: made by a person in the Vercel dashboard (on Josh's list), then filed on Mortals with
`/add-secret` as target vercel-chaoskosmos-site. Until then the autodeploy is red once a day with that instruction,
and site deploys go from Agent1s.

## Weakest premise
That Mortals' CLI (59.11.7) reads VERCEL_TOKEN the way this Mac's (50.25.6) does. Checked here only; the first real
autodeploy run after the token is filed is the proof, and a refusal there now says which of the two cases it is.
