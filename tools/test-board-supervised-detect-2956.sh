#!/bin/bash
# #2956: unit-test the recursion-safe supervised detection in install/kosmos.
# _kosmos_board_supervised must be true ONLY when the LOADED launchd job actually
# runs `board-run` -- a job still defined as `kosmos start` (the update-window
# transition, before the new plist is loaded) must read as NOT supervised, or
# cmd_start would kickstart a `kosmos start` job and recurse. Also covers: no job
# loaded, and a sandbox (AGENT_WORKFORCE_LAUNCH set) which must never touch the
# real gui domain. And _kosmos_board_label must mirror install/setup.sh's #883
# label (literal for the default home, hash-suffixed otherwise).
#
# The real function bodies are EXTRACTED from install/kosmos and sourced, so the
# test exercises the shipped code, not a copy. launchctl is stubbed via the
# KOSMOS_LAUNCHCTL seam.
set -u
cd "$(dirname "$0")/.." || exit 1
SRC="$PWD/install/kosmos"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

# Pull the two function bodies (each ends at a `}` in column 0) + the LAUNCHCTL
# default line, into a sourceable snippet.
SNIP="$(mktemp)"
awk '/^LAUNCHCTL=/{print}
     /^_kosmos_board_label\(\) \{/{l=1}
     l{print} l&&/^\}/{l=0}
     /^_kosmos_board_supervised\(\) \{/{s=1}
     s{print} s&&/^\}/{s=0}' "$SRC" > "$SNIP"
# sanity: both functions and the seam were captured
grep -q '^_kosmos_board_label()' "$SNIP" && grep -q '^_kosmos_board_supervised()' "$SNIP" && grep -q '^LAUNCHCTL=' "$SNIP" \
  || { echo "FAIL  could not extract the functions from install/kosmos"; rm -f "$SNIP"; exit 1; }

# A stub launchctl whose `print` output is chosen by KOSMOS_STUB_PRINT:
#   board-run -> a job defined with board-run in its arguments (supervised)
#   start     -> a job defined with the old `kosmos start` (NOT supervised)
#   absent    -> print exits non-zero (no such job)
STUBDIR="$(mktemp -d)"
cat > "$STUBDIR/launchctl" <<'LC'
#!/bin/bash
case "$1 ${KOSMOS_STUB_PRINT:-}" in
  "print board-run") printf '\tstate = running\n\targuments = {\n\t\t/bin/bash\n\t\t/home/x/.local/share/kosmos/bin/kosmos\n\t\tboard-run\n\t}\n'; exit 0 ;;
  "print start")     printf '\tstate = running\n\targuments = {\n\t\t/bin/bash\n\t\t/home/x/.local/share/kosmos/bin/kosmos\n\t\tstart\n\t}\n'; exit 0 ;;
  "print start-pathmatch") printf '\tstate = running\n\targuments = {\n\t\t/bin/bash\n\t\t/Users/board-run/.local/share/kosmos/bin/kosmos\n\t\tstart\n\t}\n'; exit 0 ;;
  "print absent")    exit 1 ;;
esac
exit 0
LC
chmod +x "$STUBDIR/launchctl"

# Source the extracted functions with the stub wired in and a fake home.
export KOSMOS_LAUNCHCTL="$STUBDIR/launchctl"
export KOSMOS_HOME="$HOME/.local/share/kosmos"   # the default -> literal label
# shellcheck disable=SC1090
. "$SNIP"

# --- _kosmos_board_label (mirrors setup.sh #883) ---
[ "$(_kosmos_board_label)" = "com.kosmos.board" ] \
  && ok "label: default KOSMOS_HOME -> literal com.kosmos.board" \
  || bad "label: default home gave '$(_kosmos_board_label)'"
( export KOSMOS_HOME=/tmp/some-sandbox-home
  exp="com.kosmos.board.$(printf '%s' "$KOSMOS_HOME" | shasum -a 256 | cut -c1-8)"
  [ "$(_kosmos_board_label)" = "$exp" ] ) \
  && ok "label: non-default KOSMOS_HOME -> hash-suffixed" \
  || bad "label: non-default home not hash-suffixed"

# --- _kosmos_board_supervised ---
# 1. loaded job runs board-run -> supervised
export KOSMOS_STUB_PRINT=board-run; unset AGENT_WORKFORCE_LAUNCH 2>/dev/null || true
if _kosmos_board_supervised; then ok "supervised: loaded board-run job -> yes"; else bad "supervised: board-run job not detected"; fi

# 2. loaded job still runs `start` (update window) -> NOT supervised (recursion guard)
export KOSMOS_STUB_PRINT=start
if _kosmos_board_supervised; then bad "recursion guard: an old 'start' job was treated as supervised"; else ok "recursion guard: old 'start' job -> NOT supervised"; fi

# 2b. a `start` job whose kosmos PATH literally contains "board-run" -> NOT
# supervised (the #5 false-positive: board-run must match only as a standalone
# argument line, never as a substring of a path).
export KOSMOS_STUB_PRINT=start-pathmatch
if _kosmos_board_supervised; then bad "path false-positive: 'board-run' in a path treated as supervised"; else ok "path containing 'board-run' on a 'start' job -> NOT supervised"; fi

# 3. no job loaded -> NOT supervised
export KOSMOS_STUB_PRINT=absent
if _kosmos_board_supervised; then bad "no job: treated as supervised"; else ok "no job loaded -> NOT supervised"; fi

# 4. sandbox (AGENT_WORKFORCE_LAUNCH set) -> NOT supervised even if a board-run job would print
export KOSMOS_STUB_PRINT=board-run; export AGENT_WORKFORCE_LAUNCH=/tmp/fake-launch
if _kosmos_board_supervised; then bad "sandbox: touched the real domain / treated as supervised"; else ok "sandbox (AGENT_WORKFORCE_LAUNCH set) -> NOT supervised"; fi
unset AGENT_WORKFORCE_LAUNCH

rm -rf "$STUBDIR" "$SNIP"
if [ "$fails" = 0 ]; then echo "ALL PASS (test-board-supervised-detect-2956)"; else echo "FAILURES (test-board-supervised-detect-2956)"; fi
exit "$fails"
