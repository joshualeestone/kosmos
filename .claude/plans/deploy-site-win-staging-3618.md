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

## Fail-closed choices, named
- Once the site redirects the staging pointer, a staging pointer R2 cannot serve (or a malformed
  one) REFUSES the Mac deploy (A32). That matches prod's fail-closed rule and the old refusal when
  the static pointer failed served-verify. The cost: a gap in R2 staging reds Mac deploys. Chosen
  because a staging channel nobody can read is a real defect, not noise.
- Once the staging pointer redirects, a TRANSIENT staging-probe failure falls back to comparing the
  committed copy with what is served, which differs (R2's vs the site's), so that run exits red (A37).
  The NOTE names the probe and says to re-run. Accepted: the same fail-closed rule as prod's probe.
- The ALIAS probes fail OPEN, the staging probe fails closed. If the alias `.sha256` or alias zip
  probe cannot answer, the run does not refuse: it prints a NOTE and repeats it after the final
  success line (a "BUT" line), so a run that certified less says so where the operator reads.
  Chosen because the alias is the static-or-R2 download whose state today is mid-migration (#3610);
  a transient probe must not red a Mac deploy on it.
- The alias checksum and alias-zip checks run only when the PROD pointer is served by redirect
  (they compare against the served pointer's sha). If the pointer were served statically again,
  git archive ships the committed alias, and the alias falls back to the pre-existing served-verify
  (200, not html) with no sha comparison. Accepted: a static pointer means the site, not R2, owns
  the whole Windows download again, which is what the pre-R2 checks were built for.
- A redirected alias whose checksum or bytes disagree with the prod pointer refuses (A29, A35).
  That assumes R2's alias is always the PROD build. In this repo a staging publish never touches the
  alias, but the R2 publish lives outside this repo; if it ever writes the alias on a STAGING
  publish, every Mac deploy goes red. Confirm with Homer alongside the premise below.

## Weakest premise

That R2's staging channel is the one the Windows box reads, so the site copy is merely stale.
Measured: R2 staging is 0.6.84 with a matching zip and sidecar. What would change my mind: Homer
saying the site's `latest-win-staging.json` is still authoritative for his flow.

## Tests

`tools/test-deploy-site-served-win-3600.sh`, now 41 arms: A25 to A41 are new (staging redirect,
its sidecar and bytes, no committed staging copy, R2 staging gone, committed staging newer than R2,
alias checksum static/redirected/unprobeable, alias bytes on R2, A36 proving the no-committed-copy path really verifies, A37 for a failed staging probe, and A38 for a wrong-build alias zip while its sidecar is static, A39 for a malformed served sha, A40 as the control for the #3610 warning, and A41 for the sha length check). A12 was rebuilt: the
static-pointer drift control now uses a post-deploy served copy, because a redirected staging pointer
is no longer compared with the committed one.
