#!/bin/bash
# #5471: step 8 does not call a deploy failed while it is landing. `vercel deploy` exited
# non-zero ("Error: fetch failed") on 0.7.26 and 0.7.27 after uploading everything, and both
# went live a minute later.
#
# Covers site_deploy_landed, site_deploy_landed_args_ok and site_deploy_serves_this_build
# (tools/lib/site-deploy.sh), and release.sh's step-8 block cut out of the file, run with `vercel`
# and `curl` stubbed.
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

for bad_wait in x "" 12345; do
  site_deploy_landed_args_ok 3 "$bad_wait" 2>/dev/null && bad "wait '$bad_wait' was accepted" || ok "wait '$bad_wait' is refused (not a whole number from 0 to 9999)"
done
for bad_tries in 0 00 "" x3 12345; do
  site_deploy_landed "$bad_tries" 0 true 2>/dev/null && bad "tries '$bad_tries' was accepted" || ok "tries '$bad_tries' is refused (not a whole number from 1 to 9999; 0 would make BSD seq count down and run the check twice)"
done

# ---- site_deploy_serves_this_build ----------------------------------------------------
printf 'aaa111  kosmos-9.9.9-arm64.tar.gz\n' > "$T/mine.sha256"
# The stub records the URL it was asked for (its last argument), so a wrong host, a lost /dist/ or a wrong
# name fails here instead of passing against a stub that ignores its arguments.
curl() { local a; for a in "$@"; do :; done; printf '%s\n' "${a%%\?*}" >> "$T/curl.urls"; printf '%s\n' "$*" >> "$T/curl.args"; [ -f "$T/served.sha256" ] && cat "$T/served.sha256" || return 22; }
printf 'aaa111  kosmos-9.9.9-arm64.tar.gz\n' > "$T/served.sha256"
site_deploy_serves_this_build https://h "$T/mine.sha256" kosmos-9.9.9-arm64.tar.gz && ok "the served .sha256 equals this cut's: this build" || bad "same sha not recognised"
printf 'bbb222  kosmos-9.9.9-arm64.tar.gz\n' > "$T/served.sha256"
site_deploy_serves_this_build https://h "$T/mine.sha256" kosmos-9.9.9-arm64.tar.gz && bad "an earlier attempt's build was taken for this one" || ok "a different served .sha256 (an earlier attempt at the same version): not this build"
rm -f "$T/served.sha256"
site_deploy_serves_this_build https://h "$T/mine.sha256" kosmos-9.9.9-arm64.tar.gz && bad "an unreadable served .sha256 passed" || ok "nothing served: not this build"
site_deploy_serves_this_build https://h "$T/missing.sha256" kosmos-9.9.9-arm64.tar.gz && bad "a missing local .sha256 passed" || ok "no local .sha256: not this build (never a blank-equals-blank pass)"
grep -q -- '-f' "$T/curl.args" && grep -q -- '-m 30' "$T/curl.args" && grep -q '?landed=' "$T/curl.args" && ok "it fails on an HTTP error (-f), times out (-m 30) and busts the edge cache (?landed=)" || bad "curl args: $(sort -u "$T/curl.args")"
[ "$(sort -u "$T/curl.urls")" = "https://h/dist/kosmos-9.9.9-arm64.tar.gz.sha256" ] && ok "it fetches <host>/dist/<name>.sha256 and nothing else" || bad "fetched: $(sort -u "$T/curl.urls" | tr '\n' ' ')"

# ---- step 1 checks the overrides before anything is built -----------------------------
# A source-presence guard (the exact line, inside step 1 before its fetch), not a run of step 1.
s1="$(awk '/^step "== 1\. /{f=1} f && /^git -C "\$REPO" fetch origin -q$/ {exit} f {print}' tools/release.sh)"
case "$s1" in *'site_deploy_landed_args_ok "${KOSMOS_DEPLOY_LANDED_TRIES:-24}" "${KOSMOS_DEPLOY_LANDED_WAIT_S:-15}" || { echo "nothing was built"; exit 1; }'*) ok "step 1 refuses a bad landed-check override before anything is built or pushed" ;; *) bad "step 1 does not check the overrides" ;; esac

# ---- release.sh's real step-8 block ---------------------------------------------------
# From the override check to DEPLOYED=1, cut out of the file (not a copy).
# Anchored on step 8's own override check ("nothing was deployed"); step 1 has one too ("nothing was built").
BLOCK="$(awk '/^site_deploy_landed_args_ok .*nothing was deployed/ { f=1 } f { print } f && /^DEPLOYED=1/ { exit }' tools/release.sh)"
case "$BLOCK" in
  site_deploy_landed_args_ok*'vercel deploy --prod --yes'*site_deploy_landed*site_deploy_serves_this_build*'DEPLOYED=1'*) ok "CONTROL: the step-8 block was cut out of release.sh whole (override check, deploy, landed check, DEPLOYED)" ;;
  *) bad "could not cut the step-8 block out of release.sh (anchor drift?)"; echo "test-deploy-landed-5471: $FAILS failure(s)"; exit 1 ;;
esac

# A fake REPO whose tools/verify-served.sh is the counting stub: step 8 must never run it now (step 9 does).
FR="$T/repo"; mkdir -p "$FR/tools" "$T/export"
cp "$T/verify" "$FR/tools/verify-served.sh"
mkdir -p "$T/site/dist"; printf 'aaa111  kosmos-9.9.9-arm64.tar.gz\n' > "$T/site/dist/kosmos-9.9.9-arm64.tar.gz.sha256"
# run_step8 <vercel rc> <served sha, or none> [fetches before it is served] [tries override]
#   prints the block's output then "DEPLOYED=<value>"; returns the block's exit code
run_step8() {
  (
    set -e
    export COUNT="$T/step8count" PASS_ON=1; rm -f "$COUNT" "$T/curl.urls" "$T/vercel.called"
    if [ "$2" = none ]; then rm -f "$T/served.sha256"; else printf '%s  kosmos-9.9.9-arm64.tar.gz\n' "$2" > "$T/served.sha256"; fi
    LATE="${3:-0}"
    curl() { local a n; for a in "$@"; do :; done; printf '%s\n' "${a%%\?*}" >> "$T/curl.urls"; n=$(wc -l < "$T/curl.urls")
             [ "$n" -gt "$LATE" ] && [ -f "$T/served.sha256" ] && cat "$T/served.sha256" || return 22; }
    VERCEL_RC="$1"; vercel() { : > "$T/vercel.called"; return "$VERCEL_RC"; }
    # and a failing vercel first on PATH, so no spelling of the call can reach the real CLI (--prod --yes)
    mkdir -p "$T/bin"; printf '#!/bin/sh\necho "the real vercel was reached" >&2; exit 99\n' > "$T/bin/vercel"; chmod +x "$T/bin/vercel"; PATH="$T/bin:$PATH"
    REPO="$FR"; SITE="$T/site"; V=9.9.9; POINTER_FILE=latest-staging.json; SETUP_FILE=setup-staging
    _site_export="$T/export"; DEPLOYED=0
    export KOSMOS_DEPLOY_LANDED_TRIES="${4:-3}" KOSMOS_DEPLOY_LANDED_WAIT_S=0
    HOST=https://stub.example
    eval "$BLOCK"
    echo "DEPLOYED=$DEPLOYED"
  )
}
fetches() { [ -f "$T/curl.urls" ] && wc -l < "$T/curl.urls" | tr -d ' ' || echo 0; }

out="$(run_step8 1 aaa111 1)"; rc=$?
case "$out" in *"THE DEPLOY LANDED"*"DEPLOYED=1") ok "CLI failed, this cut's build served from the 2nd check: continues to DEPLOYED=1 (rc=$rc)" ;; *) bad "landed: rc=$rc out=$out" ;; esac
[ "$rc" = 0 ] || bad "landed: the block should finish 0, got $rc"
[ "$(sort -u "$T/curl.urls")" = "https://stub.example/dist/kosmos-9.9.9-arm64.tar.gz.sha256" ] && [ "$(fetches)" = 2 ] && ok "it asked HOST for this cut's tarball .sha256, twice, then stopped" || bad "landed fetched: $(sort -u "$T/curl.urls" | tr '\n' ' ') x$(fetches)"
# A regression guard, not coverage of today's code (which never names verify-served.sh in step 8):
# it stops the full verifier creeping back into the landed check.
[ ! -f "$T/step8count" ] && ok "landed: step 8 does not run the full verifier; step 9 does, as after a CLI success" || bad "landed: the verifier ran in step 8"

out="$(run_step8 1 bbb222)"; rc=$?
[ "$rc" = 1 ] && ok "an EARLIER attempt's 9.9.9 build is served: not this deploy, so it fails as before" || bad "earlier attempt: rc=$rc"
case "$out" in *"DEPLOYED="*) bad "earlier attempt: DEPLOYED was reached" ;; *) ok "earlier attempt: DEPLOYED is never set" ;; esac

out="$(run_step8 1 none)"; rc=$?
[ "$rc" = 1 ] && ok "CLI failed and nothing served: exits with the CLI's code (1)" || bad "never served: rc=$rc"
case "$out" in *"DEPLOYED="*) bad "never served: DEPLOYED was reached, so the trap would not restore the site" ;; *) ok "never served: DEPLOYED is never set, so the trap still restores and removes the tarball" ;; esac
case "$out" in *"(#5471 record) THIS cut's build is sha256 aaa111; once deployed it is served as https://stub.example/dist/kosmos-9.9.9-arm64.tar.gz.sha256"*"vercel deploy exited"*"(#5471: not served yet, check 1"*) ok "this cut's sha and the URL to compare are printed BEFORE vercel deploy runs (a Ctrl-C or an interrupted wait still leaves the record)" ;; *) bad "sha record missing or after the poll (out=$out)" ;; esac
case "$out" in *"may still land"*"compare the served .sha256 with this cut's sha"*"aaa111"*"not seen served"*) ok "never served: the message says it may still land, points at the recorded sha, and how to read the trap's 'never served'" ;; *) bad "never served: message incomplete (out=$out)" ;; esac
[ "$(fetches)" = 3 ] && ok "never served: asked exactly KOSMOS_DEPLOY_LANDED_TRIES (3) times" || bad "never served: asked $(fetches) times"

out="$(run_step8 7 none)"; rc=$?
[ "$rc" = 7 ] && ok "the CLI's own exit code is kept (7), not flattened to 1" || bad "exit code: rc=$rc"

out="$(run_step8 143 aaa111)"; rc=$?
[ "$rc" = 143 ] && [ "$(fetches)" = 0 ] && ok "a deploy stopped by a signal (143) fails at once, without polling" || bad "signal: rc=$rc fetches=$(fetches)"
case "$out" in *"THIS cut's build is sha256 aaa111"*"vercel deploy exited 143"*"stopped by a signal"*) ok "a signal still leaves this cut's sha and the URL to compare" ;; *) bad "signal: no sha record (out=$out)" ;; esac

out="$(run_step8 130 aaa111)"; rc=$?
[ "$rc" = 130 ] && [ "$(fetches)" = 0 ] && ok "an interrupt (130) that reached vercel alone also fails at once" || bad "130: rc=$rc fetches=$(fetches)"
out="$(run_step8 137 aaa111)"; rc=$?
case "$out" in *"THE DEPLOY LANDED"*"DEPLOYED=1") ok "a KILL (137, often out of memory) after the upload is polled, and a landed build continues" ;; *) bad "137: rc=$rc out=$out" ;; esac

mv "$T/site/dist/kosmos-9.9.9-arm64.tar.gz.sha256" "$T/sha.aside"
out="$(run_step8 1 aaa111)"; rc=$?
mv "$T/sha.aside" "$T/site/dist/kosmos-9.9.9-arm64.tar.gz.sha256"
[ "$rc" = 1 ] && [ "$(fetches)" = 0 ] && ok "this cut's own .sha256 unreadable: fails at once rather than polling for minutes with nothing to compare" || bad "unreadable local sha: rc=$rc fetches=$(fetches)"

out="$(run_step8 1 aaa111 0 x3 2>&1)"; rc=$?
case "$out" in *"KOSMOS_DEPLOY_LANDED_TRIES must be a whole number from 1 to 9999, got 'x3'"*"nothing was deployed"*) ok "the refusal names the variable, the allowed range and that nothing was deployed" ;; *) bad "bad override message: $out" ;; esac
[ "$rc" = 1 ] && [ ! -f "$T/vercel.called" ] && ok "a mistyped KOSMOS_DEPLOY_LANDED_TRIES is refused BEFORE vercel deploy runs" || bad "bad override: rc=$rc vercel called=$([ -f "$T/vercel.called" ] && echo yes || echo no)"

out="$(run_step8 0 none)"; rc=$?
case "$out" in *"DEPLOYED=1") : ;; *) bad "CLI success: did not reach DEPLOYED=1 (out=$out)" ;; esac
[ -f "$T/vercel.called" ] || bad "CLI success: the vercel stub was never called, so this arm proves nothing"
[ "$rc" = 0 ] && [ "$(fetches)" = 0 ] && ok "CONTROL: the CLI succeeded, so step 8 asks the served host nothing (step 9 verifies)" || bad "CLI success: rc=$rc fetches=$(fetches)"

echo "test-deploy-landed-5471: $FAILS failure(s)"
[ "$FAILS" = 0 ]
