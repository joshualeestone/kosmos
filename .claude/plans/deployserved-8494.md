# deployserved-8494: release step 8 checks what is served after a vercel exit 0 too

Card: kosmos#8494. On the 0.8.05 staging cut (2026-11-13), step 8's `vercel deploy --prod --yes` uploaded 83.5 of
111.3 MB on a slow uplink and returned 0 with no deployment made. release.sh only checked what is served when the CLI
exited non-zero (#5471), so it set DEPLOYED=1 on the exit code; step 9 then failed the cut after six reads, and the
site commit step 7b pushed had to be reverted by hand.

## Change
tools/release.sh step 8: an exit 0 is checked the same way as a failure. Only this cut's own
kosmos-$V-arm64.tar.gz.sha256 served at HOST (site_deploy_landed + site_deploy_serves_this_build, the #5471 pair, the
same KOSMOS_DEPLOY_LANDED_TRIES/WAIT_S budget) sets DEPLOYED=1. Not served: step 8 says the upload did not become a
deployment, prints this cut's sha and the same compare/revert guidance as the failure path, and exits 1 with DEPLOYED
unset, so the trap restores the site checkout. This cut's own .sha256 unreadable: it fails at once.
A real deploy goes live as a whole when the CLI returns, so a healthy cut normally costs one fetch.

## Tests
tools/test-deploy-landed-5471.sh (cuts release.sh's real step-8 block out and runs it with vercel and curl stubbed):
the old control "a CLI success asks the host nothing" is replaced, because that is the behaviour this card removes.
New arms: exit 0 with nothing served fails (1), DEPLOYED never set, the message, exactly TRIES fetches; CONTROL: exit
0 with this cut's build served passes after one fetch; exit 0 with an earlier attempt's build served fails; exit 0
with the local .sha256 unreadable fails at once. A mutation removing the new branch reds 6 checks.
tools/test-vercel-refusal-7711.sh still passes (24). Both run in test:shell.

## Not covered, stated
- The slow uplink itself (Splinter is looking at it).
- A healthy cut now always makes at least one served fetch at step 8 (before: none on success). If the host or edge is
  slow to serve a just-landed deploy, step 8 waits up to the same budget the failure path already uses.
