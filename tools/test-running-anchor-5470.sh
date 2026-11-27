#!/bin/bash
# #5470: kosmos_running_lines <script> (tools/lib/cut-guard.sh) answers "is <script> RUNNING" from real
# processes. A run starts with the interpreter and the script; a tools/queued-heavy.sh waiter that carries
# the script as an argument, the `sh -c` shell that started that waiter, and a command that only mentions
# the script are not runs. On 0.7.27 an unanchored `pgrep -f` read a waiter as a run and deadlocked the
# cut (#5467). Real processes, not a stubbed pgrep: the bug was in what pgrep returns.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/cut-guard.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/running-anchor-5470.XXXXXX")"
PIDS=""
cleanup() { local p; for p in $PIDS; do pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# A unique script name, so nothing else on this machine can match, and a sleeper behind each shape.
NAME="fake-run-5470-$$.sh"; SCRIPT="tools/$NAME"
# The sleeper is a perl bounded wait, not `sleep 30` (kosmos#6730): a stray `pkill -f sleep` on this shared
# box matches a `sh -c "sleep 30; ..."` stand-in or a stand-in script's child sleep and ends it mid-test.
WAIT30="perl -e 'select(undef, undef, undef, 30)'"
mkdir -p "$T/tools"
printf '#!/bin/bash\n%s\n' "$WAIT30" > "$T/$SCRIPT"
printf '#!/bin/bash\n%s\n' "$WAIT30" > "$T/tools/queued-heavy-standin.sh"
chmod +x "$T/$SCRIPT" "$T/tools/queued-heavy-standin.sh"
start() { "$@" >/dev/null 2>&1 & PIDS="$PIDS $!"; disown "$!" 2>/dev/null || true; }
pids_of() { printf '%s\n' "$1" | awk 'NF {print $1}' | sort -n | tr '\n' ' '; }
# Wait (up to ~5 s) until each pid shows its own command line to pgrep: a fresh fork can briefly show its
# parent's, which would read as a missing run on a loaded Mac.
settle() { local p i; for p in "$@"; do for i in 1 2 3 4 5 6 7 8 9 10; do _kosmos_pgrep_cmdlines "${NAME//./\\.}" 2>/dev/null | awk '{print $1}' | grep -qx "$p" && break; sleep 0.5; done; done; }

# One live read of the helper into $out and $rc, with a second look when pgrep itself failed (kosmos#9045): once on a loaded
# Mac the real pgrep did, the helper rightly answered 2, and the whole validation was red for it. Only a pgrep that exited 2 or
# more, or could not be started, is looked at again: a wrong 0 or 1, or a 2 the helper gave on its own, is red at once. A pgrep that keeps failing stays
# 2, and each failure prints what pgrep said, which the helper throws away. rc 9: pgrep is not known to have answered.
live_pgrep() { command pgrep "$@"; }
LOOK_PAUSE=0.5
look() { # sets out and rc
  local i pr
  for i in 1 2 3 4 5 6; do
    [ "$i" = 1 ] || sleep "$LOOK_PAUSE"
    { : > "$T/pgrep.err" && : > "$T/pgrep.rc"; } 2>/dev/null || { out="cannot record what pgrep says in $T"; rc=9; return 0; }
    out="$(pgrep() { local r; live_pgrep "$@" 2>"$T/pgrep.err"; r=$?; echo "$r" > "$T/pgrep.rc"; return "$r"; }; kosmos_running_lines "$SCRIPT")"; rc=$?
    pr="$(cat "$T/pgrep.rc")"
    case "$pr" in
      0|1) return 0 ;;                                                         # pgrep answered: the helper's answer stands
      '') [ "$rc" = 2 ] || { out="pgrep was not asked: $out"; rc=9; return 0; }
          [ -s "$T/pgrep.err" ] || return 0 ;;                                 # a 2 of the helper's own; with words, pgrep could not be started (a fork refused under load)
      *) [ "$rc" = 2 ] || { out="pgrep failed ($pr) and the helper answered $rc"; rc=9; return 0; } ;;
    esac
    echo "NOTE  look $i could not tell: pgrep rc=${pr:-none} said: $(tr '\n' ' ' < "$T/pgrep.err")"
  done
}

# The look itself, with pgrep standing in. Two failures then an answer is that answer; failing every time stays 2, with
# pgrep's words and code printed; a 0 is never looked at again.
tries() { wc -l < "$T/tries" | tr -d ' '; }
got="$(LOOK_PAUSE=0; : > "$T/tries"; live_pgrep() { echo x >> "$T/tries"; [ "$(tries)" -gt 2 ] && return 1; echo "Cannot get process list" >&2; return 3; }; look; echo "rc=$rc out=[$out] tries=$(tries)")"
case "$got" in *"pgrep rc=3 said: Cannot get process list"*"rc=1 out=[] tries=3") ok "a pgrep that fails twice and then answers is looked at again, and its words are printed" ;; *) bad "the second look: $got" ;; esac
got="$(LOOK_PAUSE=0; : > "$T/tries"; live_pgrep() { echo x >> "$T/tries"; return 3; }; look; echo "rc=$rc tries=$(tries)")"
case "$got" in *"rc=2 tries=6") ok "CONTROL: a pgrep that always fails is still 2 after six looks" ;; *) bad "an always failing pgrep: $got" ;; esac
got="$(LOOK_PAUSE=0; : > "$T/tries"; live_pgrep() { echo x >> "$T/tries"; echo "4242 bash $SCRIPT"; }; look; echo "rc=$rc out=[$out] tries=$(tries)")"
[ "$got" = "rc=0 out=[4242 bash $SCRIPT] tries=1" ] && ok "CONTROL: an answer is taken at the first look" || bad "a first answer: $got"

got="$(LOOK_PAUSE=0; : > "$T/tries"; kosmos_running_lines() { echo x >> "$T/tries"; return 2; }; look; echo "rc=$rc tries=$(tries)")"
[ "$got" = "rc=2 tries=1" ] && ok "a 2 the helper gave without a failing pgrep is not looked at again" || bad "a 2 of the helper's own: $got"
got="$(LOOK_PAUSE=0; : > "$T/tries"; live_pgrep() { return 1; }; kosmos_running_lines() { echo x >> "$T/tries"; pgrep none; return 2; }; look; echo "rc=$rc tries=$(tries)")"
[ "$got" = "rc=2 tries=1" ] && ok "a 2 of the helper's after pgrep answered is not looked at again" || bad "a 2 after an answer: $got"
got="$(LOOK_PAUSE=0; : > "$T/tries"; live_pgrep() { return 3; }; kosmos_running_lines() { echo x >> "$T/tries"; pgrep none; return 1; }; look; echo "rc=$rc tries=$(tries)")"
[ "$got" = "rc=9 tries=1" ] && ok "nothing running is not believed, or looked at again, when pgrep failed" || bad "an answer over a failed pgrep: $got"
got="$(LOOK_PAUSE=0; : > "$T/tries"; live_pgrep() { echo x >> "$T/tries"; [ "$(tries)" -gt 1 ] && return 1; echo "fork: Resource temporarily unavailable" >&2; exit 2; }; look; echo "rc=$rc tries=$(tries)")"
case "$got" in *"pgrep rc=none said: fork: Resource"*"rc=1 tries=2") ok "a pgrep that could not be started is looked at again, with the reason printed" ;; *) bad "a refused fork: $got" ;; esac
got="$(kosmos_running_lines() { return 1; }; look; echo "rc=$rc")"
[ "$got" = "rc=9" ] && ok "nothing running is not believed when pgrep was never asked" || bad "an unasked pgrep: $got"
mkdir -p "$T/norecord/pgrep.err"   # a folder where the words go: the redirect fails and pgrep is never run
got="$(T="$T/norecord"; look; echo "rc=$rc")"
[ "$got" = "rc=9" ] && ok "nothing running is not believed when the look cannot record pgrep" || bad "an unrecorded pgrep: $got"

# Nothing running yet.
look
[ "$rc" = 1 ] && [ -z "$out" ] && ok "nothing running: returns 1 with no lines" || bad "nothing running: rc=$rc out=$out"

# The shapes that are NOT runs.
( cd "$T" && start bash tools/queued-heavy-standin.sh "#5470 standin" bash "$SCRIPT"; echo "$PIDS" > "$T/waiter.pid" ); WAITER=$(awk '{print $NF}' "$T/waiter.pid"); PIDS="$PIDS $WAITER"
start sh -c "$WAIT30; : bash $SCRIPT"; PARENT=$!
start bash -c "$WAIT30; :" "mentions-$SCRIPT"; MENTION=$!   # compound, so bash stays and keeps the mention
start bash -c "$WAIT30; : $SCRIPT"; CSTRING=$!                  # a -c command string that names the script
settle $WAITER $PARENT $MENTION $CSTRING
# CONTROL: the unanchored pattern a hand-written wait used really does match them (else this proves nothing).
loose="$(pgrep -f "${NAME//./\\.}" | tr '\n' ' ')"
cmiss=0; for p in $WAITER $PARENT $MENTION $CSTRING; do case " $loose " in *" $p "*) : ;; *) cmiss=1; bad "control: unanchored pgrep did not match pid $p, so the test cannot show the bug" ;; esac; done
[ "$cmiss" = 0 ] && ok "CONTROL: an unanchored pgrep -f matches the waiter, its sh -c parent, the mention and the -c string"

look
[ "$rc" = 1 ] && ok "a queued waiter, its sh -c parent, a mention and a -c string are NOT runs (rc 1)" || bad "non-runs matched: rc=$rc pids=$(pids_of "$out") (waiter $WAITER, parent $PARENT, mention $MENTION, -c $CSTRING)"

# The shapes that ARE runs: relative and absolute script paths, bash and an absolute interpreter.
( cd "$T" && start bash "$SCRIPT"; echo "$PIDS" > "$T/rel.pid" ); REL=$(awk '{print $NF}' "$T/rel.pid"); PIDS="$PIDS $REL"
start /bin/bash "$T/$SCRIPT"; ABS=$!
( cd "$T" && start bash -x "$SCRIPT"; echo "$PIDS" > "$T/opt.pid" ); OPT=$(awk '{print $NF}' "$T/opt.pid"); PIDS="$PIDS $OPT"
( cd "$T" && start bash -o pipefail "$SCRIPT"; echo "$PIDS" > "$T/optv.pid" ); OPTV=$(awk '{print $NF}' "$T/optv.pid"); PIDS="$PIDS $OPTV"
settle $REL $ABS $OPT $OPTV
look
got="$(pids_of "$out")"
[ "$rc" = 0 ] && ok "a real run is found (rc 0)" || bad "real runs not found: rc=$rc"
case " $got " in *" $REL "*) ok "bash tools/<script> (relative, as release.sh starts it) is a run" ;; *) bad "relative run $REL missing from: $got" ;; esac
case " $got " in *" $ABS "*) ok "/bin/bash /abs/path/tools/<script> is a run" ;; *) bad "absolute run $ABS missing from: $got" ;; esac
case " $got " in *" $OPT "*) ok "bash -x tools/<script> (a shell option before the script) is a run" ;; *) bad "option run $OPT missing from: $got" ;; esac
case " $got " in *" $OPTV "*) ok "bash -o pipefail tools/<script> (an option that takes a value) is a run" ;; *) bad "value-option run $OPTV missing from: $got" ;; esac
leaked=""; for p in $WAITER $PARENT $MENTION $CSTRING; do case " $got " in *" $p "*) leaked="$leaked $p" ;; esac; done
[ -z "$leaked" ] && ok "with real runs present, the waiter, its parent, the mention and the -c string are still not listed" || bad "non-runs listed beside the real runs:$leaked"

# Shapes that cannot be held open as live processes (bash -n exits at once), read through a stubbed pgrep
# that prints fixed lines: which are runs, which are not.
shape() { # <expect run|not> <command line>
  local want="$1" line="$2" out rc
  rm -f "$T/stub.called"
  out="$(pgrep() { : > "$T/stub.called"; printf '4242 %s\n' "$line"; }; kosmos_running_lines "$SCRIPT")"; rc=$?
  [ -f "$T/stub.called" ] || { bad "the pgrep stub was not called for: $line (the helper no longer calls pgrep by name?)"; return; }
  if [ "$want" = run ]; then [ "$rc" = 0 ] && ok "a run: $line" || bad "should be a run: $line (rc $rc)"
  else [ "$rc" = 1 ] && ok "not a run: $line" || bad "should not be a run: $line (rc $rc)"; fi
}
shape not "bash -n $SCRIPT"
shape not "bash -xn $SCRIPT"
shape not "bash -lc $SCRIPT"
shape run  "bash -eo pipefail $SCRIPT"
shape run  "bash +x $SCRIPT"
shape run  "bash -- $SCRIPT"
shape run  "bash --rcfile /x/rc $SCRIPT"
shape not  "bash -e -c : $SCRIPT"      # a bare -c as its own word is still a command string
shape run  "bash --norc $SCRIPT"
shape not  "bash ${SCRIPT%.sh}Xsh"   # the dot is literal: a name that differs only there is not this script

# _kosmos_drop_test_fixtures, the REAL function, reads the script out of an optioned line: its fixture
# check is stubbed to record the script it was handed (and to say "not a fixture", so the line passes).
for fl in "4242 bash -x tools/release.sh" "4242 /bin/bash -eo pipefail tools/run-tests.sh x" "4242 bash tools/browser-checks.sh"; do
  want="tools/release.sh"; case "$fl" in *run-tests*) want=tools/run-tests.sh ;; *browser-checks*) want=tools/browser-checks.sh ;; esac
  got="$( _kosmos_pid_is_test_fixture() { printf '%s' "$2" > "$T/fixture.script"; return 1; }; printf '%s\n' "$fl" | _kosmos_drop_test_fixtures >/dev/null; cat "$T/fixture.script" 2>/dev/null )"
  rm -f "$T/fixture.script"
  [ "$got" = "$want" ] && ok "_kosmos_drop_test_fixtures hands the fixture check the script from: $fl" || bad "fixture filter handed '$got' for: $fl (want $want)"
done
LC_ALL=en_US.UTF-8 bash -c '. tools/lib/cut-guard.sh; re="^4 bash${_KOSMOS_SH_OPTS} +x\.sh$"; [[ "4 bash -lc x.sh" =~ $re ]]' && bad "a -lc cluster matched as an option under en_US.UTF-8" || ok "the spelled-out option letters exclude c under en_US.UTF-8 too"

# A pgrep that fails is "could not tell" (2), never "nothing running" (1).
out="$(pgrep() { return 3; }; kosmos_running_lines "$SCRIPT")"; rc=$?
[ "$rc" = 2 ] && ok "a failing pgrep returns 2 (could not tell), not 1" || bad "failing pgrep: rc=$rc"
kosmos_running_lines "" >/dev/null; rc=$?
[ "$rc" = 2 ] && ok "no script named: returns 2" || bad "empty script: rc=$rc"

# #6799: _kosmos_pgrep_cmdlines does not list its own ancestors. macOS pgrep never does; procps pgrep does, and the
# caller plus every `$( )` subshell around the call carry the caller's command line, so a run would read itself as a
# second run. SELF calls it from nested subshells; SIB is a separate process matching the same pattern (the control:
# it must be listed, so this arm can fail). Off macOS, SELF also counts what raw `pgrep -fa` lists of its own
# lineage, which must be nonzero, or the filter was never exercised.
ANC="fake-anc-6799-$$"
printf '#!/bin/bash\nsleep 30\n' > "$T/tools/$ANC-sib.sh"
{
  printf '%s\n' '#!/bin/bash' '. "$1/tools/lib/cut-guard.sh"'
  printf 'out="$( ( _kosmos_pgrep_cmdlines "%s" ) )"\n' "$ANC"
  printf 'case "${OSTYPE:-}" in darwin*) raw=skip ;; *) raw="$( ( pgrep -fa "%s" | grep -c -- -self\\.sh ) )" ;; esac\n' "$ANC"
  printf '%s\n' 'echo "raw $raw"' 'printf "%s\n" "$out"'
} > "$T/tools/$ANC-self.sh"
start bash "$T/tools/$ANC-sib.sh"; sib="${PIDS##* }"
for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$ANC-sib\.sh" | grep -qx "$sib" && break; sleep 0.5; done
got="$(bash "$T/tools/$ANC-self.sh" "$PWD")"
printf '%s\n' "$got" | grep -qE "^$sib " && ok "_kosmos_pgrep_cmdlines lists a separate matching process (control)" \
  || bad "the separate matching process $sib was not listed: [$got]"
printf '%s\n' "$got" | grep -q -- '-self\.sh' && bad "_kosmos_pgrep_cmdlines listed its own ancestors: [$got]" \
  || ok "_kosmos_pgrep_cmdlines does not list its own ancestors"
case "$(printf '%s\n' "$got" | sed -n 's/^raw //p')" in
  skip) ok "macOS: pgrep excludes its own ancestors itself (no raw count to check)" ;;
  ''|0) bad "raw pgrep -fa listed none of SELF's own lineage, so the ancestor filter was never exercised" ;;
  *) ok "raw pgrep -fa lists SELF's own lineage here, and the filter removed it" ;;
esac

# #6799: the Linux branch on THIS host's bash (3.2 on macOS, where a bare case pattern `)` inside `$( )` fails to
# parse at run time, which `bash -n` cannot see): OSTYPE forced to linux-gnu and pgrep stubbed to list the calling
# subshell itself (not $$: a walk that started at $$ would keep it), the caller, its parent and a stranger. Only the
# stranger may remain; with nothing matching, the answer is 1.
got="$(bash -c '. tools/lib/cut-guard.sh; OSTYPE=linux-gnu; uname(){ echo Linux; }; ( me="$(exec sh -c '\''echo "$PPID"'\'')"; pgrep(){ printf "%s\n" "$me subshell" "$PPID parent" "$$ caller" "99999 stranger"; }; _kosmos_pgrep_cmdlines x ); echo "rc=$?"' 2>&1)"
[ "$got" = "$(printf '%s\n' '99999 stranger' 'rc=0')" ] && ok "the Linux branch drops the caller's lineage and keeps a stranger, on this bash" \
  || bad "the Linux branch on this bash: [$got]"
got="$(bash -c '. tools/lib/cut-guard.sh; OSTYPE=linux-gnu; uname(){ echo Linux; }; pgrep(){ return 1; }; ( _kosmos_pgrep_cmdlines x ); echo "rc=$?"' 2>&1)"
[ "$got" = "rc=1" ] && ok "the Linux branch passes pgrep's 1 (nothing) through" || bad "the Linux branch with no match: [$got]"

# #6799: an inherited OSTYPE that is not darwin does not send a Mac to `pgrep -fa` (bash keeps an inherited OSTYPE;
# on macOS -a means "include ancestors" and prints no command lines, so the guards would match nothing). uname is
# stubbed to Darwin and pgrep to print the flags it was given.
got="$(bash -c '. tools/lib/cut-guard.sh; OSTYPE=linux-gnu; uname(){ echo Darwin; }; pgrep(){ echo "flags $1"; }; _kosmos_pgrep_cmdlines x' 2>&1)"
[ "$got" = "flags -fl" ] && ok "a Mac with a non-darwin OSTYPE still uses pgrep -fl" || bad "a Mac with OSTYPE=linux-gnu: [$got]"

# kosmos#9149 (Mortals 11-26 20:28): under a UTF-8 locale pgrep exits 3 ("illegal byte sequence") whenever ANY process
# has a command line that is not valid UTF-8, so every guard read "could not tell". The real pgrep, with such a process
# alive: a script that is not running reads as not running (1), not as could-not-tell (2).
U8="$(locale -a 2>/dev/null | grep -i -m1 -E '^(en_US|C)\.utf-?8$')"; U8="${U8:-en_US.UTF-8}"
bash -c 'exec -a "$(printf "zz\377probe-%s" "$1")" perl -e "select(undef, undef, undef, 60)"' _ "$$" < /dev/null > /dev/null 2>&1 & BB=$!
n=0; while [ "$n" -lt 50 ] && ! LC_ALL=C command pgrep -f "probe-$$" >/dev/null; do perl -e 'select(undef, undef, undef, 0.1)'; n=$((n + 1)); done
cr=0; LC_ALL="$U8" command pgrep -f "no-such-process-$$" >/dev/null 2>&1 || cr=$?; echo "note  control: plain pgrep under $U8 with that process alive exits $cr (3 shows the defect)"
got="$(LC_ALL="$U8" LANG="$U8" bash -c '. tools/lib/cut-guard.sh; kosmos_running_lines tools/no-such-script-9149.sh; echo "rc=$?"' 2>&1)"
kill "$BB" 2>/dev/null; wait "$BB" 2>/dev/null
[ "$got" = "rc=1" ] && ok "a non-UTF-8 command line elsewhere does not make the guards read could-not-tell" || bad "with a non-UTF-8 command line alive: [$got]"

echo "test-running-anchor-5470: $FAILS failure(s)"
[ "$FAILS" = 0 ]
