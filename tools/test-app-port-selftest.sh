#!/bin/bash
# kosmos#955: prove the bounded #910 selftest FAILS a stale bundle instead of hanging.
#
# Drives tools/lib/app-port-selftest.sh against stub bundles (a current one, a behind
# one that hangs, a behind one that exits with no port), so the detection is provable
# without a real macOS bundle. It is a real control: it asserts BOTH the detect-current
# arm and the detect-behind arm, and it asserts the bound actually bounds -- if
# bounded_run ever hung, THIS TEST would hang, which is itself the regression the card
# is about.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tools/lib/app-port-selftest.sh
. "$HERE/lib/app-port-selftest.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/apst-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0
T=2   # short bound so the test is fast and a real hang is caught quickly

check() {  # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected $2, got $3)"
    fails=$((fails + 1))
  fi
}

# --- stub bundles -----------------------------------------------------------------
# CURRENT: answers the real flag with the #910 port and exits; anything else starts
# the "app" and sits there (a real #910 bundle does not know the fake flag).
cur="$tmp/current"
cat > "$cur" <<'EOF'
#!/bin/bash
if [ "$1" = "--kosmos-app-port-selftest" ]; then
  if [ "$2" = 501 ]; then echo 16180; else echo "$((16180 + 1 + ($2 % 3999)))"; fi
  exit 0
fi
sleep 999
EOF
chmod +x "$cur"

# BEHIND-HANG: predates the flag, so it starts the app for EVERYTHING (the real bug).
bhang="$tmp/behind-hang"
cat > "$bhang" <<'EOF'
#!/bin/bash
sleep 999
EOF
chmod +x "$bhang"

# BEHIND-EXIT: predates the flag and exits immediately with no port.
bexit="$tmp/behind-exit"
cat > "$bexit" <<'EOF'
#!/bin/bash
exit 0
EOF
chmod +x "$bexit"

# --- bounded_run bounds a hanging bundle (the core: the test must not hang) --------
start=$(date +%s)
bounded_run "$T" "$bhang" --kosmos-app-port-selftest 501 >/dev/null 2>&1; rc=$?
elapsed=$(( $(date +%s) - start ))
check "bounded_run returns 124 on a hanging bundle" 124 "$rc"
if [ "$elapsed" -le $((T + 4)) ]; then
  check "bounded_run stayed within the bound" ok ok
else
  check "bounded_run stayed within the bound" ok "SLOW-${elapsed}s"
fi

# --- bounded_run returns a quick command's output and rc --------------------------
out="$(bounded_run "$T" "$cur" --kosmos-app-port-selftest 501)"; rc=$?
check "bounded_run returns a quick command's rc" 0 "$rc"
check "bounded_run returns a quick command's stdout" 16180 "$out"

# --- the premise check: current vs behind -----------------------------------------
kosmos_app_selftest_current "$cur" "$T";   check "a CURRENT bundle is detected as #910-aware" 0 "$?"
kosmos_app_selftest_current "$bhang" "$T"; check "a BEHIND (hanging) bundle is detected as behind" 1 "$?"
kosmos_app_selftest_current "$bexit" "$T"; check "a BEHIND (exit, no port) bundle is detected as behind" 1 "$?"

echo "---"
if [ "$fails" -eq 0 ]; then
  echo "app-port-selftest: all checks passed"
  exit 0
fi
echo "app-port-selftest: $fails FAILED"
exit 1
