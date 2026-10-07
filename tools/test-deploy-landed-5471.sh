#!/bin/bash
# #5471: step 8 does not call a deploy failed while it is landing. `vercel deploy` exited
# non-zero ("Error: fetch failed") on 0.7.26 and 0.7.27 after uploading everything, and both
# went live a minute later. Step 8 now asks the served host (verify-served.sh) before failing.
#
# Two layers:
#  - site_deploy_landed itself (tools/lib/site-deploy.sh): retries, gives up, stops on a pass.
#  - release.sh's REAL step-8 block, cut out of the file (not a copy), run with `vercel` and
#    verify-served.sh stubbed: a CLI failure that lands continues to DEPLOYED=1; one that never
#    lands exits with the CLI's code and never reaches DEPLOYED=1; a CLI success never asks.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO_ROOT="$PWD"
. tools/lib/site-deploy.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/deploy-landed-5471.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# ---- site_deploy_landed ---------------------------------------------------------------
# A verify stub that passes on call number $PASS_ON (0 = never), counting its calls in a file.
cat > "$T/verify" <<'EOS'
#!/bin/bash
n=$(( $(cat "$COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$COUNT"
echo "${KOSMOS_VERIFY_POINTER:-} ${KOSMOS_VERIFY_SETUP:-}" > "$COUNT.env"
[ "$PASS_ON" != 0 ] && [ "$n" -ge "$PASS_ON" ]
EOS
chmod +x "$T/verify"
calls() { cat "$COUNT"; }

export COUNT="$T/c1" PASS_ON=3
site_deploy_landed 5 0 "$T/verify" >/dev/null; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 3 ] && ok "landed on the 3rd check: returns 0 and stops asking (3 calls)" || bad "pass on 3rd: rc=$rc calls=$(calls)"

export COUNT="$T/c2" PASS_ON=0
site_deploy_landed 4 0 "$T/verify" >/dev/null; rc=$?
[ "$rc" = 1 ] && [ "$(calls)" = 4 ] && ok "never served: returns 1 after exactly the 4 tries asked for" || bad "never: rc=$rc calls=$(calls)"

export COUNT="$T/c3" PASS_ON=1
out="$(site_deploy_landed 4 0 "$T/verify")"; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 1 ] && [ -z "$out" ] && ok "served at once: one call, no waiting line" || bad "at once: rc=$rc calls=$(calls) out=$out"

for bad_tries in 0 "" x3; do
  site_deploy_landed "$bad_tries" 0 true 2>/dev/null && bad "tries '$bad_tries' was accepted" || ok "tries '$bad_tries' is refused (not a positive whole number; BSD seq would count 0 down to 1 and run the check twice)"
done

# ---- site_deploy_serves_this_build ----------------------------------------------------
printf 'aaa111  kosmos-9.9.9-arm64.tar.gz\n' > "$T/mine.sha256"
curl() { [ -f "$T/served.sha256" ] && cat "$T/served.sha256" || return 22; }
printf 'aaa111  kosmos-9.9.9-arm64.tar.gz\n' > "$T/served.sha256"
site_deploy_serves_this_build https://h "$T/mine.sha256" kosmos-9.9.9-arm64.tar.gz && ok "the served .sha256 equals this cut's: this build" || bad "same sha not recognised"
printf 'bbb222  kosmos-9.9.9-arm64.tar.gz\n' > "$T/served.sha256"
site_deploy_serves_this_build https://h "$T/mine.sha256" kosmos-9.9.9-arm64.tar.gz && bad "an earlier attempt's build was taken for this one" || ok "a different served .sha256 (an earlier attempt at the same version): not this build"
rm -f "$T/served.sha256"
site_deploy_serves_this_build https://h "$T/mine.sha256" kosmos-9.9.9-arm64.tar.gz && bad "an unreadable served .sha256 passed" || ok "nothing served: not this build"
site_deploy_serves_this_build https://h "$T/missing.sha256" kosmos-9.9.9-arm64.tar.gz && bad "a missing local .sha256 passed" || ok "no local .sha256: not this build (never a blank-equals-blank pass)"

# ---- release.sh's real step-8 block ---------------------------------------------------
BLOCK="$(awk '/^_vdep_rc=0$/ { f=1 } f { print } f && /^DEPLOYED=1/ { exit }' tools/release.sh)"
case "$BLOCK" in
  *'vercel deploy --prod --yes'*site_deploy_landed*'DEPLOYED=1'*) ok "CONTROL: the step-8 block was cut out of release.sh whole (deploy, landed check, DEPLOYED)" ;;
  *) bad "could not cut the step-8 block out of release.sh (anchor drift?)"; echo "test-deploy-landed-5471: $FAILS failure(s)"; exit 1 ;;
esac

# A fake REPO whose tools/verify-served.sh is the counting stub, and a `vercel` that exits $VERCEL_RC.
FR="$T/repo"; mkdir -p "$FR/tools" "$T/export"
cp "$T/verify" "$FR/tools/verify-served.sh"
mkdir -p "$T/site/dist"; printf 'aaa111  kosmos-9.9.9-arm64.tar.gz\n' > "$T/site/dist/kosmos-9.9.9-arm64.tar.gz.sha256"
run_step8() { # vercel_rc pass_on [served sha] -> prints the block's output, then "DEPLOYED=<value>"; returns the block's exit code
  (
    set -e
    export COUNT="$T/step8count" PASS_ON="$2"; rm -f "$COUNT" "$COUNT.env"
    printf '%s  kosmos-9.9.9-arm64.tar.gz\n' "${3:-aaa111}" > "$T/served.sha256"
    VERCEL_RC="$1"; vercel() { return "$VERCEL_RC"; }
    REPO="$FR"; SITE="$T/site"; V=9.9.9; POINTER_FILE=latest-staging.json; SETUP_FILE=setup-staging
    _site_export="$T/export"; DEPLOYED=0
    export KOSMOS_DEPLOY_LANDED_TRIES=3 KOSMOS_DEPLOY_LANDED_WAIT_S=0
    eval "$BLOCK"
    echo "DEPLOYED=$DEPLOYED"
  )
}

out="$(run_step8 1 2)"; rc=$?
case "$out" in *"THE DEPLOY LANDED"*"DEPLOYED=1") ok "CLI failed, deploy landed on the 2nd check: continues to DEPLOYED=1 (rc=$rc)" ;; *) bad "landed: rc=$rc out=$out" ;; esac
[ "$rc" = 0 ] || bad "landed: the block should finish 0, got $rc"
[ "$(cat "$T/step8count.env")" = "latest-staging.json setup-staging" ] && ok "the verifier is asked about this cut's channel (latest-staging.json, setup-staging)" || bad "verifier env: $(cat "$T/step8count.env")"

out="$(run_step8 1 1 bbb222)"; rc=$?
[ "$rc" = 1 ] && ok "an EARLIER attempt's 9.9.9 build is served and passes the verifier: NOT this deploy, so it fails as before" || bad "earlier attempt: rc=$rc"
case "$out" in *"DEPLOYED="*) bad "earlier attempt: DEPLOYED was reached" ;; *) : ;; esac
[ ! -f "$T/step8count" ] && ok "an earlier attempt's build: the full verifier is not even run (the cheap own-build check fails first)" || bad "earlier attempt: verifier ran $(cat "$T/step8count") times"

out="$(run_step8 1 0)"; rc=$?
[ "$rc" = 1 ] && ok "CLI failed and never served: exits with the CLI's code (1)" || bad "never served: rc=$rc"
case "$out" in *"DEPLOYED="*) bad "never served: DEPLOYED was reached, so the trap would not restore the site" ;; *) ok "never served: DEPLOYED is never set, so the trap still restores and removes the never-served tarball" ;; esac
case "$out" in *"may still land"*"re-hash"*) ok "never served: the message says it may still land and to measure before a revert or re-cut" ;; *) bad "never served: message does not warn it may still land (out=$out)" ;; esac
[ "$(cat "$T/step8count")" = 3 ] && ok "never served: asked exactly KOSMOS_DEPLOY_LANDED_TRIES (3) times" || bad "never served: asked $(cat "$T/step8count") times"

out="$(run_step8 7 0)"; rc=$?
[ "$rc" = 7 ] && ok "the CLI's own exit code is kept (7), not flattened to 1" || bad "exit code: rc=$rc"

out="$(run_step8 0 0)"; rc=$?
case "$out" in *"DEPLOYED=1") : ;; *) bad "CLI success: did not reach DEPLOYED=1 (out=$out)" ;; esac
[ "$rc" = 0 ] && [ ! -f "$T/step8count" ] && ok "CONTROL: the CLI succeeded, so the served host is not asked here (step 9 still verifies)" || bad "CLI success: rc=$rc asked=$(cat "$T/step8count" 2>/dev/null)"

echo "test-deploy-landed-5471: $FAILS failure(s)"
[ "$FAILS" = 0 ]
