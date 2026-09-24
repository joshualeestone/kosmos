# deploy-site: the Windows staging pointer and alias checksum served from R2 (#3618, #3610)

## Problem

After #3600, two Windows files are still served from the site commit while their siblings redirect
to R2, and both go stale on every Windows publish (measured 2026-09-24 13:50 CDT):
- `/dist/latest-win-staging.json`: the site serves its static 0.6.81 copy, while R2 keeps its own
  staging channel (0.6.84, with its zip and `.sha256` served and matching). 0.6.81 is not in R2.
- `/dist/kosmos-win-x64.zip.sha256`: the site serves 0.6.72's sha, while the alias zip (redirected)
  is 0.6.89's bytes (#3610).

The fix is two changes, and ORDER MATTERS: the site `vercel.json` redirects (a separate site PR)
must deploy with THIS deploy-site already on main. Otherwise that deploy's own staged check compares
R2's staging pointer against the stale committed one and exits red.

## Call

- Staging pointer: probe it without `-L`, as #3600 does for prod. If it redirects, the served
  pointer is the truth. Verify the build it names (shape, sidecar == pointer sha, and hashed bytes
  when it is newer than prod), and do NOT compare it with the committed copy. The superseded rule
  from #3600 still applies.
- Alias checksum: its served `.sha256` must equal the served prod pointer's sha (same build). If it
  is served from R2, a mismatch refuses. If it is served statically (today), a mismatch is a WARNING
  naming the fix, so Mac deploys do not go red until the site redirect lands.
- The pointer reader and the sidecar+bytes check are now shared functions, used by prod and staging.

## Rejected

- Making the static-alias mismatch a refusal. Today's prod has exactly that state, so every Mac
  deploy would go red until the site PR lands: the #3600 failure again.
- Deleting the committed `latest-win-staging.json` from the site. In-repo tools
  (`promote-channel.sh --family win`, `win-staging-verified.sh`) still read it; that is the old
  pre-R2 flow and is out of scope here.

## Weakest premise

That R2's staging channel is the one the Windows box reads, so the site copy is merely stale.
Measured: R2 staging is 0.6.84 with a matching zip and sidecar. What would change my mind: Homer
saying the site's `latest-win-staging.json` is still authoritative for his flow.

## Tests

`tools/test-deploy-site-served-win-3600.sh`, now 29 arms: A25 to A29 are new. A12 was rebuilt: the
static-pointer drift control now uses a post-deploy served copy, because a redirected staging pointer
is no longer compared with the committed one.
