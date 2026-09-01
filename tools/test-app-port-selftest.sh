#!/bin/bash
# kosmos#955: prove the bounded #910 selftest FAILS a stale bundle instead of hanging,
# and that the bound kills the WHOLE process group (a forked child is reaped, not
# orphaned).
#
# Drives tools/lib/app-port-selftest.sh against stub bundles, so the detection is provable
# without a real macOS bundle. A real control: it asserts detect-current AND detect-behind,
# that bounded_run returns 124 within the bound (if it ever hung, THIS TEST would hang --
# the #955 regression), and that a FORKED grandchild does not survive the kill -- which a
# naive kill-the-launcher WOULD leak, so this arm reds a regression to launcher-only kill.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tools/lib/app-port-selftest.sh
. "$HERE/lib/app-port-selftest.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/apst-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0
T=2                 # short bound: fast, and a real hang is caught quickly
FORK=918273001      # a distinctive sleep the stub FORKS: orphaned by a naive kill, reaped
                    # only by the group-kill -- this is what makes the no-orphan arm real.
LAUNCH=918273002    # the stub's launcher sleep

check() {  # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1"
  else echo "FAIL  $1 (expected $2, got $3)"; fails=$((fails + 1)); fi
}

# CURRENT: answers the real flag with the pinned uid-501 port and exits; anything else
# starts the "app" and sits there (a #910-aware bundle does not know other flags).
cur="$tmp/current"
cat > "$cur" <<EOF
#!/bin/bash
if [ "\$1" = "--kosmos-app-port-selftest" ] && [ "\$2" = 501 ]; then echo 16180; exit 0; fi
exec sleep $LAUNCH
EOF
chmod +x "$cur"

# BEHIND-HANG: predates the flag, so it starts the app for EVERYTHING (the real bug). It
# FORKS a child before becoming the launcher, so a launcher-only kill would orphan the
# child -- exactly the leak the group-kill exists to prevent.
bhang="$tmp/behind-hang"
cat > "$bhang" <<EOF
#!/bin/bash
sleep $FORK &
exec sleep $LAUNCH
EOF
chmod +x "$bhang"

# BEHIND-EXIT: predates the flag and exits immediately with no port.
bexit="$tmp/behind-exit"; printf '#!/bin/bash\nexit 0\n' > "$bexit"; chmod +x "$bexit"

# BEHIND-WRONG: answers the flag but with the WRONG port (a bundle that regressed the value).
bwrong="$tmp/behind-wrong"; printf '#!/bin/bash\necho 9999\nexit 0\n' > "$bwrong"; chmod +x "$bwrong"

# --- bounded_run bounds a hanging bundle AND takes its FORKED child with it --------
start=$(date +%s)
bounded_run "$T" "$bhang" --kosmos-app-port-selftest 501 >/dev/null 2>&1; rc=$?
elapsed=$(( $(date +%s) - start ))
check "bounded_run returns 124 on a hanging bundle" 124 "$rc"
# The completion itself proves no-hang (a broken bound would hang this test). A generous
# ceiling well under the 999s hang catches a far-too-slow bound without flaking on load.
if [ "$elapsed" -le 60 ]; then check "bounded_run did not hang (bounded)" ok ok
else check "bounded_run did not hang (bounded)" ok "SLOW-${elapsed}s"; fi
sleep 1   # let the group-kill land
# The FORKED child (not the launcher) is the real test: a naive kill "$pid" reaps the
# launcher but ORPHANS this; only kill -- -"$pid" (the group) reaps it. So this arm reds
# a regression back to a launcher-only kill.
check "the FORKED child is reaped by the group-kill (not orphaned)" 0 "$(pgrep -f "sleep $FORK" | wc -l | tr -d ' ')"

# --- bounded_run returns a quick command's output and rc --------------------------
out="$(bounded_run "$T" "$cur" --kosmos-app-port-selftest 501)"; rc=$?
check "bounded_run returns a quick command's rc" 0 "$rc"
check "bounded_run returns a quick command's stdout" 16180 "$out"

# --- the premise check: current vs behind -----------------------------------------
kosmos_app_selftest_current "$cur" 16180 "$T";    check "a CURRENT bundle is #910-aware" 0 "$?"
kosmos_app_selftest_current "$bhang" 16180 "$T";  check "a BEHIND (hanging) bundle is behind" 1 "$?"
kosmos_app_selftest_current "$bexit" 16180 "$T";  check "a BEHIND (exit, no port) bundle is behind" 1 "$?"
kosmos_app_selftest_current "$bwrong" 16180 "$T"; check "a bundle answering the WRONG port is behind" 1 "$?"

# The CURRENT premise check exits fast on the real flag (starts no app, forks nothing),
# and every BEHIND arm above was group-killed. Prove nothing leaked across the whole run.
sleep 1
check "no selftest child leaked across the run" 0 "$(pgrep -f "sleep $FORK" | wc -l | tr -d ' ')"

echo "---"
if [ "$fails" -eq 0 ]; then echo "app-port-selftest: all checks passed"; exit 0; fi
echo "app-port-selftest: $fails FAILED"; exit 1
