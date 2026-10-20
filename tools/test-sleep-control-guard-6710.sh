#!/bin/bash
# kosmos#6710: a guard that stops new long-lived bare `sleep N` CONTROL processes coming back into
# tools/test-*.sh. On this shared box a stray `pkill -f sleep` matches any command line that
# contains "sleep" and can end a test's live stand-in mid-test (#6671). A control must be a
# `perl -e 'select(undef, undef, undef, N)'` bounded wait instead (no "sleep" in its command line,
# still ends by itself if cleanup never runs).
#
# What this flags (a persistent sleep control): a `sleep <integer>` that is exec'd, backgrounded,
# or a `( sleep N` subshell. What it does NOT flag: fractional sleeps (sleep 0.x) and short inline
# poll pauses (sleep 1 in a `do ... done` loop are not backgrounded), `--sleep N` flags, arithmetic
# (`sleep $((...))`) and variable (`sleep "$n"`) args, `exec -a NAME sleep` (renamed: no "sleep" at
# runtime), comment lines, and any line carrying the author opt-out `# sleep-control-ok`.
#
# Like tools/test-precommit-pipe-lint-4911.sh, it has a must-FLAG battery and must-ACCEPT controls so
# a matcher that cannot refuse, or one that refuses everything, turns this red.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
fails=0
ok()  { printf 'ok   %s\n' "$1"; }
bad() { printf 'BAD  %s\n' "$1"; fails=$((fails + 1)); }

# ALLOWLIST: basenames NOT scanned, each with why it is exempt. These carry bare-sleep controls that
# are out of #6710's scope and are named on the card as a follow-up; the entries come out as each is
# converted. Kano owns removing the two #6671 entries when leakctl-6671 merges (so they do not
# outlive Mona Lisa's fix), and the follow-up entries when the follow-up card lands.
ALLOWLIST="
test-test-leak-guard-4273.sh          # Mona Lisa's (#6671, branch leakctl-6671); remove when it merges
test-start-waits-for-starting-board-6586.sh # Mona Lisa's (#6671); remove when leakctl-6671 merges
test-browser-run-guard.sh             # #6730 (sleep 30 & stand-ins)
test-connector-verbs.sh               # #6730 (stub scripts greped by ^sleep 300; matched by name)
test-cut-claim-renew-5134.sh          # #6730 (sleep 30 & arm holder)
test-data-root-1511.sh                # #6730 (sleep 37, pgrep -fx matched by name)
test-pause-foreign-board-964.sh       # #6730 (sleep 30 & foreign board)
test-restart-local-board.sh           # #6730 (timed ( sleep 11 ) fixture)
test-site-autodeploy-5589.sh          # #6730 (many sleep 300 &, some command-under-test)
test-stopmark-6651.sh                 # #6730 (sleep 300 & live)
"
allowlisted() { case "$ALLOWLIST" in *"
$1 "*|*"
$1"*) return 0 ;; esac
  # tolerate trailing-comment lines: match the basename token at a line start
  printf '%s\n' "$ALLOWLIST" | grep -Eq "^$1([[:space:]]|$)"; }

# _is_sleep_control <line>: exit 0 if the line is a banned long-lived bare-sleep control.
_is_sleep_control() {
  local line="$1" trimmed
  case "$line" in *'# sleep-control-ok'*) return 1 ;; esac          # author opt-out
  trimmed="${line#"${line%%[![:space:]]*}"}"                        # strip leading whitespace
  case "$trimmed" in '#'*) return 1 ;; esac                          # comment-only line
  # a sleep with an integer arg, as a word (not --sleep, not display sleep/FX_SLEEP):
  printf '%s' "$line" | grep -Eq '(^|[^-[:alnum:]_./"])sleep[[:space:]]+[0-9]' || return 1
  printf '%s' "$line" | grep -Eq '(^|[^-[:alnum:]_./"])sleep[[:space:]]+[0-9]+\.' && return 1   # fractional pause
  printf '%s' "$line" | grep -Eq '(^|[^-[:alnum:]_./"])sleep[[:space:]]+\$'       && return 1   # $var or $((...))
  printf '%s' "$line" | grep -Eq '(^|[^-[:alnum:]_./"])sleep[[:space:]]+"'        && return 1   # "$n" quoted var
  printf '%s' "$line" | grep -Eq '(^|[^-[:alnum:]_./"])sleep[[:space:]]+0([^.0-9]|$)' && return 1 # `sleep 0`: a zero-duration dead-pid fixture, not a persistent control
  # persistent-process shapes:
  printf '%s' "$line" | grep -Eq '(^|[^-[:alnum:]_])exec[[:space:]]+sleep[[:space:]]+[0-9]' && return 0   # exec'd (not exec -a)
  printf '%s' "$line" | grep -Eq '\([[:space:]]*sleep[[:space:]]+[0-9]'                     && return 0   # ( sleep N subshell
  # backgrounded: the & directly follows the sleep (allowing redirections between), NOT merely any &
  # elsewhere on the line (which over-flagged a brief pause / a perl-internal sleep that shared a line
  # with an unrelated backgrounded job):
  printf '%s' "$line" | grep -Eq 'sleep[[:space:]]+[0-9]+([[:space:]]+[0-9]*[<>][&]?[^[:space:]&]*)*[[:space:]]+&([^&]|$)' && return 0
  return 1
}

# --- must-FLAG: real control shapes the matcher must catch ----------------------------------------
mustflag() { _is_sleep_control "$1" && ok "flags: $2" || bad "MISSED (should flag): $2 [$1]"; }
mustflag 'sleep 30 & cut_self=$!'                                   "a backgrounded sleep with a captured pid"
mustflag 'sleep 60 </dev/null >/dev/null 2>&1 & HOLDER=$!'         "a backgrounded sleep with redirections"
mustflag '( cd / && exec sleep 30 ) & kt_real=$!'                  "an exec sleep in a backgrounded subshell"
mustflag '( exec sleep 30 ) & p1=$!'                               "an exec sleep subshell"
mustflag '( sleep 30 ) & pR=$!'                                    "a ( sleep N ) subshell"
mustflag 'sleep 300 & echo "$!" >> "$W/ahead"'                    "a backgrounded sleep in a loop body"
mustflag "bash -c 'sleep 60 </dev/null >/dev/null 2>&1 & wait'"    "a backgrounded sleep inside a bash -c"
mustflag 'sleep 3600 </dev/null >/dev/null 2>&1 & SUITE=$!'       "a long backgrounded sleep holder"
mustflag '  set -m; sleep 30 </dev/null >/dev/null 2>&1 & SPG=$!; set +m' "a backgrounded sleep under set -m"

# --- must-ACCEPT: legitimate shapes the matcher must NOT flag -------------------------------------
mustok() { _is_sleep_control "$1" && bad "FALSE FLAG (should accept): $2 [$1]" || ok "accepts: $2"; }
mustok 'for _ in 1 2 3; do [ -s "$f" ] && break; sleep 0.2; done'  "a fractional poll pause"
mustok 'while [ "$i" -lt 30 ]; do foo; sleep 1; i=$((i+1)); done'   "a one-second inline poll pause"
mustok 'while ... ; do sleep 5 </dev/null >/dev/null 2>&1; alive || exit 0; done' "a 5 s inline watchdog pause"
mustok 'sleep 15'                                                   "a bare inline sleep (not a persistent control)"
mustok 'bash "$E2E/tools/test-install.sh" --sleep 8 & harness=$!'   "a --sleep flag (installer CLI, not a sleep command)"
mustok 'hold() { exec -a "kosmos-gate-stub-$TAG" sleep 60; }'       "an exec -a renamed sleep (no sleep at runtime)"
mustok 'sleep $((U+9)) & H=$!'                                      "an arithmetic unique-length sleep (matched by exact length)"
mustok 'perl -e '"'"'select(undef, undef, undef, 30)'"'"' & wp=$!'  "the perl-select replacement itself"
mustok '# whereas the mention arm asserts across the `sleep 4` at step 4' "a comment mentioning sleep"
mustok 'sleep 30 & legacy=$!   # sleep-control-ok: documented exception' "a line carrying the opt-out marker"
mustok 'sleep "$2"'                                                 "a sleep with a variable arg (fixture seam)"
mustok 'o=$(... /bin/bash $QH "d" sleep 3 2>&1); until_true 20 ...' "an inline sleep whose only & is inside 2>&1 before a )"
mustok 'do sleep 5 </dev/null >/dev/null 2>&1; alive || exit 0; done' "an inline sleep whose only & is inside 2>&1 before a ;"
mustok 'sleep 5 && echo done'                                       "an inline sleep followed by && (not a backgrounding &)"
mustok 'sleep 0 & DEAD=$!; wait "$DEAD"'                            "a zero-duration dead-pid fixture"

# --- the real scan: every tools/test-*.sh not allowlisted must carry no bare-sleep control --------
scanned=0; clean=0
for f in "$HERE"/test-*.sh; do
  base="$(basename "$f")"
  [ "$base" = "test-sleep-control-guard-6710.sh" ] && continue
  if allowlisted "$base"; then continue; fi
  scanned=$((scanned + 1))
  file_hits=""
  while IFS= read -r ln || [ -n "$ln" ]; do
    _is_sleep_control "$ln" && file_hits="$file_hits
    $ln"
  done < "$f"
  if [ -n "$file_hits" ]; then
    bad "$base has a bare-sleep control (convert to perl -e 'select(...)', or add # sleep-control-ok with a reason):$file_hits"
  else
    clean=$((clean + 1))
  fi
done
ok "scanned $scanned non-allowlisted test-*.sh, $clean clean"

# The four files #6710 converts MUST be in the scanned (non-allowlisted) set and clean.
for g in test-cut-guard.sh test-light-side-4911.sh test-queued-heavy-4977.sh test-tunnel-handshake-gate.sh; do
  if allowlisted "$g"; then bad "#6710's own file tools/$g is allowlisted, so its conversion is not actually guarded"; fi
  [ -f "$HERE/$g" ] || bad "tools/$g is missing, so #6710's conversion was not checked"
done

[ "$fails" -eq 0 ] && { echo "all sleep-control-guard checks passed"; exit 0; }
echo "$fails sleep-control-guard check(s) failed"; exit 1
