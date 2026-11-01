#!/bin/bash
# kosmos#7711: a refused `vercel deploy` is tried again; nothing else is.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d "${TMPDIR:-/tmp}/vercel-7711.XXXXXX"); trap 'rm -rf "$T"' EXIT
. "$HERE/lib/site-deploy.sh"
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass + 1)); echo "ok    $1"; else fail=$((fail + 1)); echo "FAIL  $1 (got '$2', want '$3')"; fi; }
mkdir -p "$T/bin" "$T/site"
# vercel: logs its first word and cwd; a deploy answers the next line of $T/script ("refuse", "other", "ok", or a number).
cat > "$T/bin/vercel" <<EOS
#!/bin/bash
echo "\$1 \$(basename "\$PWD")" >> "$T/calls"
[ "\$1" = deploy ] || exit 0
n=\$(( \$(grep -c '^deploy' "$T/calls") ))
a=\$(sed -n "\${n}p" "$T/script")
case "\$a" in
  refuse) echo "Deploying chaoskosmos"; echo "Error: Not authorized" >&2; exit 1 ;;
  other) echo "Error: something else" >&2; exit 1 ;;
  ok) echo "https://x.vercel.app"; exit 0 ;;
  *) exit "\$a" ;;
esac
EOS
chmod +x "$T/bin/vercel"; PATH="$T/bin:$PATH"
mkdir -p "$T/tmp"
export KOSMOS_VERCEL_RETRY_S=0 KOSMOS_VERCEL_AUTH_FILE="$T/auth.json" KOSMOS_VERCEL_TMP="$T/tmp"   # an exit in the hook leaves its capture, as release.sh's EXIT trap expects
once() { ( cd "$T/site" && vercel deploy --prod --yes ); }
run() { rm -f "$T/calls"; printf '%s\n' "$@" > "$T/script"; out=$(site_vercel_deploy "$T/site" once 2>&1); rc=$?; deploys=$(grep -c '^deploy' "$T/calls"); }

run ok; ok "a clean deploy runs once" "$rc $deploys" "0 1"
ok "whoami runs first, in the export" "$(sed -n 1p "$T/calls")" "whoami site"
run refuse ok; ok "a refusal is tried again" "$rc $deploys" "0 2"
case "$out" in *"Not authorized"*"trying again"*"https://x.vercel.app"*) r=yes ;; *) r="$out" ;; esac; ok "and the log shows both" yes "$r"
run refuse refuse refuse ok; ok "up to the fourth try" "$rc $deploys" "0 4"
run refuse refuse refuse refuse ok; ok "and no further, returning its code" "$rc $deploys" "1 4"
run other ok; ok "any other failure is not retried" "$rc $deploys" "1 1"
run 137 ok; ok "a killed deploy is not retried, and keeps its code" "$rc $deploys" "137 1"
run 130 ok; ok "nor an interrupted one" "$rc $deploys" "130 1"
run refuse other ok; ok "a refusal then another failure stops there" "$rc $deploys" "1 2"
KOSMOS_VERCEL_TRIES=2; run refuse refuse ok; ok "KOSMOS_VERCEL_TRIES bounds it" "$rc $deploys" "1 2"; unset KOSMOS_VERCEL_TRIES
KOSMOS_VERCEL_TRIES=x; run refuse refuse refuse refuse ok; ok "a bad setting falls back to 4" "$rc $deploys" "1 4"; unset KOSMOS_VERCEL_TRIES
# release.sh runs under set -e and pipefail, so a refusal must not end the shell inside the helper.
r=$(set -eo pipefail; printf 'refuse\nok\n' > "$T/script"; rm -f "$T/calls"; site_vercel_deploy "$T/site" once >/dev/null 2>&1; echo reached); ok "a refusal then a success, under set -e and pipefail" "$r" reached
# A signal is never retried, whatever it printed first.
printf '#!/bin/bash\necho "Error: Not authorized"; exit 130\n' > "$T/bin/vercel-sig"; chmod +x "$T/bin/vercel-sig"
sigd() { "$T/bin/vercel-sig"; }; rm -f "$T/calls"; out=$(site_vercel_deploy "$T/site" sigd 2>&1); rc=$?; n=$(printf '%s\n' "$out" | grep -c 'try [0-9] of'); ok "exit 130 after the words is not retried" "$rc $n" "130 1"
# The hook runs before each retry, not before the first try, and may stop the cut.
hook() { echo x >> "$T/hooked"; }; rm -f "$T/hooked"; KOSMOS_VERCEL_BEFORE_RETRY=hook; run refuse refuse ok; ok "the hook runs before each retry" "$(wc -l < "$T/hooked" | tr -d ' ')" 2
hook() { echo FROZEN; exit 3; }; printf 'refuse\nok\n' > "$T/script"; rm -f "$T/calls"; out=$( (site_vercel_deploy "$T/site" once) 2>&1 ); rc=$?; ok "a hook that exits stops the deploy" "$rc $(grep -c '^deploy' "$T/calls")" "3 1"
unset KOSMOS_VERCEL_BEFORE_RETRY
KOSMOS_VERCEL_TMP="$T/kt"; mkdir -p "$T/kt"; run ok; ok "the capture goes in KOSMOS_VERCEL_TMP and is removed" "$(ls "$T/kt" | wc -l | tr -d ' ')" 0; KOSMOS_VERCEL_TMP="$T/tmp"
# The token note: time left, never the token.
now=$(date +%s); printf '{"token":"SECRET-T","refreshToken":"SECRET-R","expiresAt": %s}\n' $((now + 100)) > "$T/auth.json"
run ok; case "$out" in *SECRET*) r=leaked ;; *"token left"*s*) r=clean ;; *) r="$out" ;; esac; ok "the note never prints the token" "$r" clean
l=$(site_vercel_token_left); case "$l" in 9?s|100s) r=ok ;; *) r="$l" ;; esac; ok "it prints the seconds left" "$r" ok
rm -f "$T/auth.json"; ok "no file reads unknown" "$(site_vercel_token_left)" unknown
# The wiring: release.sh's one deploy goes through the helper.
ok "release.sh deploys through the helper, with the freeze check" "$(grep -c 'KOSMOS_VERCEL_BEFORE_RETRY=_vdep_freeze_check .*site_vercel_deploy "$_site_export" _vdep_once || _vdep_rc=$?$' "$HERE/release.sh")" 1
ok "the freeze check also runs before the first try" "$(grep -c '^_vdep_freeze_check$' "$HERE/release.sh")" 1
ok "and its one deploy line is the helper's command" "$(grep -cE '^[^#]*vercel deploy --prod --yes' "$HERE/release.sh")" 1
ok "inside _vdep_once" "$(grep -c '^_vdep_once() { ( cd "$_site_export" && vercel deploy --prod --yes ); }$' "$HERE/release.sh")" 1
echo; echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
