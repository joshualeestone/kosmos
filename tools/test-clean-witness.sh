#!/bin/bash
# The launchd witness's judging rules, driven arm by arm (#566). The lib is
# the same file clean-machine.sh sources, so the harness and this test
# cannot drift; launchctl is stubbed through the lib's own seam, so nothing
# here touches the real gui domain.
set -u
cd "$(dirname "$0")/.." || exit 1
. tools/lib/launchd-witness.sh

FAILS=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(printf '\t')"
REAL="/Users/someone/Library/LaunchAgents"
SB="/tmp/kosmos-clean-XXAB12"

expect() { # $1 name, $2 got, $3 want
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got: '$2' want: '$3')"; fi
}

# 1. Agreement judges to silence.
expect "unchanged snapshots print nothing" \
  "$(lw_judge "com.kosmos.board${T}${REAL}/com.kosmos.board.plist" \
              "com.kosmos.board${T}${REAL}/com.kosmos.board.plist" "$REAL" "$SB")" ""

# 2. Somebody else's sandboxed create is SANDBOX: ignorable, but named.
expect "another run's sandbox job judges SANDBOX" \
  "$(lw_judge "" "com.kosmos.agent.bl2${T}/tmp/kosmos-other-run/home/Library/LaunchAgents/com.kosmos.agent.bl2.plist" "$REAL" "$SB")" \
  "SANDBOX com.kosmos.agent.bl2 /tmp/kosmos-other-run/home/Library/LaunchAgents/com.kosmos.agent.bl2.plist"

# 3. This run's own leftover is OURS: the uninstall leak the old witness
#    caught, which the path split must not amnesty.
expect "this sandbox's leftover judges OURS" \
  "$(lw_judge "" "com.kosmos.agent.t1${T}${SB}/home/Library/LaunchAgents/com.kosmos.agent.t1.plist" "$REAL" "$SB")" \
  "OURS com.kosmos.agent.t1 ${SB}/home/Library/LaunchAgents/com.kosmos.agent.t1.plist"

# 4. A job under the real LaunchAgents is REAL, appearing or vanishing.
expect "a real job appearing judges REAL" \
  "$(lw_judge "" "com.kosmos.agent.pixel${T}${REAL}/com.kosmos.agent.pixel.plist" "$REAL" "$SB")" \
  "REAL com.kosmos.agent.pixel ${REAL}/com.kosmos.agent.pixel.plist"
expect "a real job vanishing judges REAL too" \
  "$(lw_judge "com.kosmos.agent.pixel${T}${REAL}/com.kosmos.agent.pixel.plist" "" "$REAL" "$SB")" \
  "REAL com.kosmos.agent.pixel ${REAL}/com.kosmos.agent.pixel.plist"

# 5. A job that outran its own path read is UNKNOWN, never guessed about.
expect "an unreadable path judges UNKNOWN" \
  "$(lw_judge "" "com.kosmos.agent.flash${T}(gone)" "$REAL" "$SB")" \
  "UNKNOWN com.kosmos.agent.flash"

# 6. A path with a space survives the plumbing whole.
expect "a spaced path survives judging intact" \
  "$(lw_judge "" "com.kosmos.agent.sp${T}/tmp/with space/j.plist" "$REAL" "$SB")" \
  "SANDBOX com.kosmos.agent.sp /tmp/with space/j.plist"

# 7. The snapshot half, through the lib's own launchctl seam: list and
#    print answered by a stub, paths landing beside their labels.
STUB_DIR="$(mktemp -d)"
cat > "$STUB_DIR/launchctl" <<'STUB'
#!/bin/sh
case "$1" in
  list)  printf 'PID\tStatus\tLabel\n-\t0\tcom.kosmos.board\n-\t0\tcom.kosmos.agent.zed\n' ;;
  print) case "$2" in
           */com.kosmos.board) printf '  path = /real/LaunchAgents/com.kosmos.board.plist\n' ;;
           */com.kosmos.agent.zed) exit 1 ;;  # vanished between list and print
         esac ;;
esac
STUB
chmod 755 "$STUB_DIR/launchctl"
GOT="$(LAUNCHD_WITNESS_LAUNCHCTL="$STUB_DIR/launchctl" lw_snapshot)"
WANT="com.kosmos.agent.zed${T}(gone)
com.kosmos.board${T}/real/LaunchAgents/com.kosmos.board.plist"
expect "lw_snapshot pairs each label with the path read at the same moment" "$GOT" "$WANT"
rm -rf "$STUB_DIR"

if [ "$FAILS" -eq 0 ]; then
  echo "clean witness: all arms hold (agree, sandbox, ours, real x2, unknown, spaced, snapshot)"
fi
exit "$FAILS"
