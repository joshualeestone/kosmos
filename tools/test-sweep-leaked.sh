#!/bin/bash
# The leaked-supervisor sweep, driven arm by arm (#626). launchctl is stubbed
# through the witness lib's own seam, so nothing here touches the real gui
# domain; the plist-file fact is driven with real files in a temp dir. The
# posture under test is the card's: name before reaping, never touch REAL or a
# live SANDBOX, and never let "could not look" read as "clean".
set -u
cd "$(dirname "$0")/.." || exit 1

FAILS=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
REAL_DIR="$T/LaunchAgents"
mkdir -p "$REAL_DIR"

# A live sandbox whose plist still exists, and a leaked one whose dir is gone.
LIVE_SB="$T/kosmos-live-run/home/Library/LaunchAgents"
mkdir -p "$LIVE_SB"
printf 'x' > "$LIVE_SB/com.kosmos.agent.live.plist"
printf 'x' > "$REAL_DIR/com.kosmos.board.plist"
GONE_PLIST="$T/kosmos-cleaned-run/home/Library/LaunchAgents/com.kosmos.agent.bl2.plist"
# (the cleaned run's dir is deliberately never created)

# The stub answers list/print for four jobs, and records every bootout it is
# asked for -- the test's proof of exactly what the sweep touches.
STUB="$T/launchctl"
BOOTLOG="$T/bootouts"
: > "$BOOTLOG"
cat > "$STUB" <<STUBEOF
#!/bin/sh
case "\$1" in
  list)  printf 'PID\tStatus\tLabel\n'
         printf -- '-\t0\tcom.kosmos.board\n'
         printf -- '-\t0\tcom.kosmos.agent.live\n'
         printf -- '-\t0\tcom.kosmos.agent.bl2\n'
         printf -- '-\t0\tcom.kosmos.agent.flash\n' ;;
  print) case "\$2" in
           */com.kosmos.board)      printf '  path = $REAL_DIR/com.kosmos.board.plist\n' ;;
           */com.kosmos.agent.live) printf '  path = $LIVE_SB/com.kosmos.agent.live.plist\n' ;;
           */com.kosmos.agent.bl2)  printf '  path = $GONE_PLIST\n' ;;
           *) exit 1 ;;   # flash vanished between list and print
         esac ;;
  bootout) printf '%s\n' "\$2" >> "$BOOTLOG" ;;
esac
STUBEOF
chmod 755 "$STUB"

# 1. Report mode: every row named, only the leak counted, exit 1, no bootouts.
OUT="$(SWEEP_REAL_LAUNCH_DIR="$REAL_DIR" LAUNCHD_WITNESS_LAUNCHCTL="$STUB" tools/sweep-leaked-supervisors.sh)"
RC=$?
[ "$RC" -eq 1 ] && ok "report mode exits 1 when a leak is found" || bad "report mode exit (got $RC want 1)"
echo "$OUT" | grep -q "REAL     com.kosmos.board" && ok "the real job is named REAL" || bad "the real job is missing or misjudged: $OUT"
echo "$OUT" | grep -q "SANDBOX  com.kosmos.agent.live" && ok "the live sandbox is named and left alone" || bad "the live sandbox row is wrong: $OUT"
echo "$OUT" | grep -q "LEAKED   com.kosmos.agent.bl2" && ok "the cleaned-away sandbox is named LEAKED" || bad "the leak is missing: $OUT"
echo "$OUT" | grep -q "UNKNOWN  com.kosmos.agent.flash" && ok "a vanished job is UNKNOWN, never guessed about" || bad "the vanished job is wrong: $OUT"
echo "$OUT" | grep -q "none touched" && ok "report mode says it touched nothing" || bad "report mode is silent about its own restraint"
[ -s "$BOOTLOG" ] && bad "report mode called bootout: $(cat "$BOOTLOG")" || ok "report mode never calls bootout"

# 2. Reap mode: ONLY the leak is booted out; REAL and live SANDBOX survive.
OUT2="$(SWEEP_REAL_LAUNCH_DIR="$REAL_DIR" LAUNCHD_WITNESS_LAUNCHCTL="$STUB" tools/sweep-leaked-supervisors.sh --reap)"
RC2=$?
[ "$RC2" -eq 0 ] && ok "reap mode exits 0 when every leak reaped" || bad "reap mode exit (got $RC2 want 0)"
echo "$OUT2" | grep -q "REAPED   com.kosmos.agent.bl2" && ok "the leak is reaped and says so" || bad "the reap is unnamed: $OUT2"
echo "$OUT2" | grep -q "session it already made is NOT touched\|Any session" && ok "the reap names what it does not touch" || bad "the reap implies a clean sweep of sessions it never looked at"
WANT_BOOT="gui/$(id -u)/com.kosmos.agent.bl2"
GOT_BOOT="$(cat "$BOOTLOG")"
[ "$GOT_BOOT" = "$WANT_BOOT" ] && ok "exactly one bootout, of exactly the leak" || bad "bootouts (got: '$GOT_BOOT' want: '$WANT_BOOT')"

# 3. A clean machine says so and exits 0.
CLEAN_STUB="$T/launchctl-clean"
printf '#!/bin/sh\ncase "$1" in list) printf "PID\\tStatus\\tLabel\\n" ;; esac\n' > "$CLEAN_STUB"
chmod 755 "$CLEAN_STUB"
OUT3="$(LAUNCHD_WITNESS_LAUNCHCTL="$CLEAN_STUB" tools/sweep-leaked-supervisors.sh)"
RC3=$?
[ "$RC3" -eq 0 ] && ok "a clean machine exits 0" || bad "clean exit (got $RC3 want 0)"
echo "$OUT3" | grep -q "nothing to judge" && ok "a clean machine is said, not silent" || bad "clean machine output: $OUT3"
echo "$OUT3" | grep -q "nothing leaked" && ok "the clean verdict is named" || bad "no clean verdict: $OUT3"

# 4. Could-not-look refuses rather than reading as clean.
BROKEN_STUB="$T/launchctl-broken"
printf '#!/bin/sh\nexit 1\n' > "$BROKEN_STUB"
chmod 755 "$BROKEN_STUB"
OUT4="$(LAUNCHD_WITNESS_LAUNCHCTL="$BROKEN_STUB" tools/sweep-leaked-supervisors.sh)"
RC4=$?
[ "$RC4" -eq 2 ] && ok "could-not-look exits 2, its own code" || bad "could-not-look exit (got $RC4 want 2)"
echo "$OUT4" | grep -q "could not look" && ok "could-not-look is said in words" || bad "could-not-look output: $OUT4"
echo "$OUT4" | grep -q "nothing leaked" && bad "a failed look was dressed as a clean machine" || ok "a failed look never claims clean"

# 5. A bootout that fails leaves the leak NAMED and the exit loud.
STUBBORN="$T/launchctl-stubborn"
sed 's/bootout) printf .*$/bootout) exit 3 ;;/' "$STUB" > "$STUBBORN"
chmod 755 "$STUBBORN"
OUT5="$(SWEEP_REAL_LAUNCH_DIR="$REAL_DIR" LAUNCHD_WITNESS_LAUNCHCTL="$STUBBORN" tools/sweep-leaked-supervisors.sh --reap)"
RC5=$?
[ "$RC5" -eq 1 ] && ok "a failed reap exits 1" || bad "failed-reap exit (got $RC5 want 1)"
echo "$OUT5" | grep -q "bootout FAILED" && ok "a failed reap is named, not swallowed" || bad "failed reap output: $OUT5"

if [ "$FAILS" -eq 0 ]; then
  echo "sweep: all arms hold (report, reap, clean, could-not-look, stubborn)"
fi
exit "$FAILS"
