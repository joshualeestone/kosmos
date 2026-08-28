#!/bin/bash
# The three quiet paths of #561, arm by arm, plus the silent control.
#
# 🛑 WHY THIS FILE EXISTS. `install/kosmos-report-hook.sh` carries a "loud
# check" whose entire job is to make sure Kosmos NEVER REPORTS SILENCE WHEN IT
# CANNOT REPORT AT ALL. #561 states the reason: a board with no reports looks
# exactly like a board of idle agents, so a hook that fails quietly is worse
# than no hook.
#
# ⚠️ AND UNTIL THIS FILE, THE GUARD ITSELF HAD NO TEST. Measured before writing
# it: the three loud sentences appeared in exactly ONE file in the repo, the
# hook, with a passing control (10 files mention the hook by name). So the one
# mechanism protecting against invisible failure was itself unwatched.
#
# ⭐ THAT IS THE SAME SHAPE `test-report-hook-source.sh` was written for, in its
# own words: "#1058 shipped as 30 lines of shell with NO TEST. The behaviour it
# changes is invisible." Shell, untested, and the failure mode is silence.
#
# Driven through KOSMOS_REPORT_CLI, the hook's own seam, with stub CLIs.
# Nothing here touches a real board.
set -u
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

HOOK="$(cd "$(dirname "$0")/.." && pwd)/install/kosmos-report-hook.sh"
[ -r "$HOOK" ] || { echo "FAIL  $HOOK not found"; exit 1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# A CLI that speaks the verb and delivers. The `report` probe must mention
# needs_you or the version guard refuses before the code under test runs.
cat > "$T/good" <<'STUB'
#!/bin/bash
[ "$#" -eq 1 ] && [ "$1" = "report" ] && { echo "usage: kosmos report <started|working|idle|needs_you|blocked|stopped>"; exit 2; }
exit 0
STUB

# A CLI from before the verb: its generic list never contains needs_you.
cat > "$T/old" <<'STUB'
#!/bin/bash
echo "usage: kosmos <start|stop|restart|status|open|version|msg|post|reply>"
exit 2
STUB

# A CLI that speaks the verb and cannot land the line.
cat > "$T/nodeliver" <<'STUB'
#!/bin/bash
[ "$#" -eq 1 ] && [ "$1" = "report" ] && { echo "usage: kosmos report <started|working|idle|needs_you|blocked|stopped>"; exit 2; }
echo "the board is not running on this computer" >&2
exit 1
STUB
chmod +x "$T/good" "$T/old" "$T/nodeliver"

# Each arm gets its own throttle dir and pane so the once-per-session marker
# from one cannot suppress the next.
fire() { # $1 = CLI path -> echoes the hook's stdout
  KOSMOS_REPORT_CLI="$1" TMPDIR="$T/tmp.$RANDOM.$$" TMUX_PANE="%$RANDOM" \
    bash "$HOOK" <<< '{"hook_event_name":"SessionStart","source":"startup"}' 2>/dev/null
}

# ---- arm 1: no CLI at all ------------------------------------------------
out="$(fire "$T/does-not-exist")"
case "$out" in
  *"reporting is OFF"*"no runnable kosmos CLI"*)
    ok "no CLI: says so loudly" ;;
  "") bad "no CLI: SILENT -- the board will read this as an idle agent" ;;
  *)  bad "no CLI: said something else: $out" ;;
esac

# ---- arm 2: a CLI older than the report verb ------------------------------
out="$(fire "$T/old")"
case "$out" in
  *"reporting is OFF"*"does not support the report verb"*)
    ok "stale CLI: says so loudly" ;;
  "") bad "stale CLI: SILENT -- this is the #561 trap, every report no-ops" ;;
  *)  bad "stale CLI: said something else: $out" ;;
esac

# ---- arm 3: the delivery failure the first two guards cannot see ----------
out="$(fire "$T/nodeliver")"
case "$out" in
  *"reporting is OFF"*"could not be recorded"*)
    ok "undeliverable: says so loudly" ;;
  "") bad "undeliverable: SILENT -- the chain is broken past the CLI and nobody is told" ;;
  *)  bad "undeliverable: said something else: $out" ;;
esac
# ⭐ And it must carry the CLI's OWN reason, not a genericised one: the person
# needs to read "the board is not running" rather than "something went wrong".
case "$out" in
  *"the board is not running on this computer"*)
    ok "undeliverable: surfaces the CLI's own sentence" ;;
  *)  bad "undeliverable: swallowed the real reason, leaving a generic message: $out" ;;
esac

# ---- arm 4: THE CONTROL, and the file is worthless without it -------------
# A guard that shouts on every path is not a guard, it is noise. This proves
# the check can stay quiet, so the three PASSes above mean something.
out="$(fire "$T/good")"
case "$out" in
  "") ok "working CLI: silent (the control)" ;;
  *)  bad "working CLI: shouted anyway, so the loud arms prove nothing: $out" ;;
esac

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS (4 arms + control)"; else echo "$FAILS FAILED"; fi
exit "$FAILS"
