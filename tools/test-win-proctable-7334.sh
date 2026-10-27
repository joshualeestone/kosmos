#!/bin/bash
# #7334: on Windows (Git Bash) the guards in tools/lib/cut-guard.sh and tools/lib/process-fixture.sh read the process
# table from Git Bash's /proc, through ps, pgrep and lsof shell functions that tools/lib/process-fixture.sh defines there
# and nowhere else. Elsewhere this file checks only that none of them is defined (the gate) and stops. On Windows it
# runs them against real processes: a live and a gone pid, pgrep -fa leaving out itself, a regex it cannot read, a
# Windows program's argv[0], every other form going to the real ps, a waiting suite's marker reading as live, the
# suite and harness name arms seeing a stand-in, and the node --test ancestor rule seeing past a Windows program
# (a bash started by a test file under node --test is a fixture; one started by plain node is not).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/cut-guard.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }

# The gate: Windows is read from uname when the lib is sourced, never from the environment.
case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
if [ "$WIN" = 0 ]; then
  got="$(_KOSMOS_PROC_WIN=1 bash -c '. tools/lib/cut-guard.sh; echo "$_KOSMOS_PROC_WIN"; declare -F ps pgrep lsof _kosmos_win_native_ancestors')"
  [ "$got" = 0 ] && ok "not Windows: no ps, pgrep or lsof function is defined, and an inherited _KOSMOS_PROC_WIN=1 changes nothing" \
    || bad "not Windows, but the lib defined a Windows reader: [$got]"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
fi
got="$(_KOSMOS_PROC_WIN=0 bash -c '. tools/lib/cut-guard.sh; echo "$_KOSMOS_PROC_WIN"; declare -F ps pgrep lsof _kosmos_win_native_ancestors | tr "\n" " "')"
[ "$got" = "1
ps pgrep lsof _kosmos_win_native_ancestors " ] && ok "Windows: the readers are defined, and an inherited _KOSMOS_PROC_WIN=0 does not switch them off" \
  || bad "Windows: [$got]"

T="$(mktemp -d "${TMPDIR:-/tmp}/win-proctable-7334.XXXXXX")"
PIDS=""
cleanup() { local p; for p in $PIDS; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
start() { "$@" </dev/null >/dev/null 2>&1 & PIDS="$PIDS $!"; }
# A stand-in's command line shows once it has exec'd; wait for it (up to 3 s), as test-cut-guard.sh's q_ready does.
shows() { local i; for i in $(seq 1 30); do case "$(ps -ww -o command= -p "$1")" in $2) return 0 ;; esac; sleep 0.1; done; return 1; }

# --- ps, for a live and a gone pid ---------------------------------------------
TAG="win-proctable-7334-$$"
start perl -e 'select(undef, undef, undef, 60)' "$TAG"; P=$!
shows "$P" "perl *$TAG" || bad "FIXTURE: the stand-in $P never showed its own command line"
[ "$(ps -o ppid= -p "$P")" = "$$" ] && ok "ps -o ppid= is this shell for its own child" || bad "ps -o ppid=: [$(ps -o ppid= -p "$P")] not $$"
pg="$(ps -o pgid= -p "$P")"; case "$pg" in ''|*[!0-9]*) bad "ps -o pgid=: [$pg]" ;; *) ok "ps -o pgid= is a number ($pg)" ;; esac
[ "$(ps -ww -o command= -p "$P")" = "perl -e select(undef, undef, undef, 60) $TAG" ] && [ "$(ps -o command= -p "$P")" = "$(ps -ww -o command= -p "$P")" ] \
  && ok "ps -o command= (with and without -ww) is the argv joined by spaces" || bad "ps -o command=: [$(ps -ww -o command= -p "$P")]"
a="$(TZ=UTC LC_ALL=C ps -o lstart= -p "$P")"; sleep 1.1; b="$(TZ=UTC LC_ALL=C ps -o lstart= -p "$P")"
case "$a" in [A-Z][a-z][a-z]' '[A-Z][a-z][a-z]' '*' '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' '[0-9][0-9][0-9][0-9]) good=1 ;; *) good=0 ;; esac
[ "$good" = 1 ] && [ "$a" = "$b" ] && ok "ps -o lstart= reads as ps prints it, the same a second later ($a)" || bad "ps -o lstart=: [$a] then [$b]"
( : ) & DEAD=$!; wait "$DEAD"
out="$(ps -o ppid= -p "$DEAD")"; rc=$?
out2="$(ps -ww -o command= -p "$DEAD")$(ps -o lstart= -p "$DEAD")"
[ "$rc" = 1 ] && [ -z "$out$out2" ] && ok "a gone pid prints nothing and exits 1, as ps does" || bad "a gone pid: rc=$rc [$out$out2]"
out="$(ps -p "$$" 2>&1)"; case "$out" in *PID*) ok "any other ps form goes to the real ps" ;; *) bad "ps -p passthrough: [$out]" ;; esac
c="$(lsof -a -p "$$" -d cwd -Fn | sed -n 's/^n//p')"
[ "$c" = "$(pwd)" ] && ok "lsof -d cwd names the cwd ($c)" || bad "lsof cwd: [$c] not [$(pwd)]"

# --- pgrep -fa -----------------------------------------------------------------
out="$(echo "SELF $BASHPID"; pgrep -fa "perl .*$TAG")"; rc=$?
self="$(printf '%s\n' "$out" | sed -n 's/^SELF //p')"
lines="$(printf '%s\n' "$out" | grep -v '^SELF ')"
[ "$rc" = 0 ] && [ "$lines" = "$P perl -e select(undef, undef, undef, 60) $TAG" ] && ok "pgrep -fa finds the stand-in, as 'pid command'" \
  || bad "pgrep -fa: rc=$rc [$lines]"
out="$(echo "SELF $BASHPID"; pgrep -fa 'test-win-proctable-7334')"
self="$(printf '%s\n' "$out" | sed -n 's/^SELF //p')"
pids=" $(printf '%s\n' "$out" | grep -v '^SELF ' | awk '{print $1}' | tr '\n' ' ')"
case "$pids" in *" $self "*) bad "pgrep -fa listed itself ($self in$pids)" ;;
  *" $$ "*) ok "pgrep -fa leaves out itself and lists the caller (as procps pgrep)" ;;
  *) bad "pgrep -fa did not list this shell ($$ not in$pids)" ;; esac
pgrep -fa '^zz-no-such-command-7334$' >/dev/null; rc=$?
[ "$rc" = 1 ] && ok "pgrep -fa with no match exits 1" || bad "no match: rc=$rc"
pgrep -fa '(' >/dev/null 2>&1; rc=$?
[ "$rc" = 2 ] && ok "pgrep -fa with a regex it cannot read exits 2 (could not tell)" || bad "bad regex: rc=$rc"

# --- a Windows program's argv[0] -------------------------------------------------
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  bad "FIXTURE: no node on PATH, so the Windows-program and node --test arms cannot run"
else
  start node -e 'setTimeout(() => {}, 60000)' "$TAG"; N=$!
  if shows "$N" "node *$TAG"; then ok "a Windows program's argv[0] reads as its bare name (node, not C:\\...\\node.exe)"
  else bad "a Windows program's command: [$(ps -ww -o command= -p "$N")]"; fi
fi

# --- the suite queue's marker, and the suite and harness name arms -------------
export KOSMOS_RUN_MARKER_DIR="$T/markers"; mkdir -p "$KOSMOS_RUN_MARKER_DIR"
kosmos_mark_suite_waiting && _kosmos_suite_waiter_live "$$" && [ -n "$(sed -n 4p "$KOSMOS_RUN_MARKER_DIR/suitewait.$$" 2>/dev/null)" ] \
  && ok "a waiting suite's marker reads as live (its command and start time match)" || bad "the waiter marker: [$(cat "$KOSMOS_RUN_MARKER_DIR"/suitewait.* 2>/dev/null)]"
rm -f "$KOSMOS_RUN_MARKER_DIR"/suitewait.*
mkdir -p "$T/tools"
printf '#!/bin/bash\nperl -e "select(undef, undef, undef, 60)"\n' > "$T/tools/run-tests.sh"
printf '#!/bin/bash\nperl -e "select(undef, undef, undef, 60)"\n' > "$T/tools/test-install.sh"
start bash "$T/tools/run-tests.sh"; S=$!
start bash "$T/tools/test-install.sh"; H=$!
shows "$S" "bash */tools/run-tests.sh" && shows "$H" "bash */tools/test-install.sh" || bad "FIXTURE: the stand-ins never showed"
case " $(_kosmos_suite_candidates | awk '{print $1}' | tr '\n' ' ')" in *" $S "*) ok "the suite name arm sees a running bash tools/run-tests.sh" ;;
  *) bad "the suite name arm missed $S: [$(_kosmos_suite_candidates)]" ;; esac
case " $(kosmos_running_lines tools/test-install.sh | awk '{print $1}' | tr '\n' ' ')" in *" $H "*) ok "the harness name arm sees a running bash tools/test-install.sh" ;;
  *) bad "the harness name arm missed $H" ;; esac
# The stand-in is this shell's own child, so the check is asked as another run would ask it (a gone pid as its self).
out="$(KOSMOS_HARNESS_SELF_PID="$DEAD" KOSMOS_HARNESS_KEEP_FIXTURES=1 kosmos_refuse_if_harness_live "this check" 2>&1)"; rc=$?
[ "$rc" = 1 ] && case "$out" in *"already running"*) true ;; *) false ;; esac && ok "kosmos_refuse_if_harness_live refuses beside it" || bad "harness check: rc=$rc [$out]"
kill "$S" "$H" 2>/dev/null; wait "$S" "$H" 2>/dev/null

# --- the node --test ancestor rule, past Windows programs -----------------------
if [ -n "$NODE" ]; then
  if _kosmos_pid_is_test_fixture "$$"; then
    echo "SKIP  the node --test arms: this test itself runs under node --test, so every bash it starts is a fixture"
  else
    printf '#!/bin/bash\ncd "%s" || exit 9\n. tools/lib/cut-guard.sh\nif _kosmos_pid_is_test_fixture "$$"; then echo fixture; else echo real; fi > "$1"\n' "$(pwd)" > "$T/probe.sh"
    # The same file both ways: run by plain node, and as a test file by node --test. Paths go to node in its own form.
    printf 'require("child_process").spawnSync("bash", [process.env.PROBE_7334, process.env.OUT_7334], { stdio: "inherit" });\n' > "$T/probe.test.js"
    W="$(cygpath -m "$T")"
    PROBE_7334="$W/probe.sh" OUT_7334="$W/under-node" node "$W/probe.test.js" >/dev/null 2>&1
    PROBE_7334="$W/probe.sh" OUT_7334="$W/under-test" node --test "$W/probe.test.js" >/dev/null 2>&1
    [ "$(cat "$T/under-test" 2>/dev/null)" = fixture ] && ok "a bash a test file started under node --test is a fixture (seen past the Windows node processes)" \
      || bad "under node --test: [$(cat "$T/under-test" 2>/dev/null)]"
    [ "$(cat "$T/under-node" 2>/dev/null)" = real ] && ok "a bash plain node started is not a fixture" \
      || bad "under plain node: [$(cat "$T/under-node" 2>/dev/null)]"
  fi
fi

# --- review 1 -------------------------------------------------------------------
# A suite started with a backslashed Windows path to its script is still seen (only argv[0] was read as a path before).
WS="$(cygpath -w "$T/tools/run-tests.sh")"
start bash "$WS"; S=$!
shows "$S" "bash */tools/run-tests.sh" || bad "FIXTURE: the backslash stand-in never showed: [$(ps -ww -o command= -p "$S")]"
case " $(_kosmos_suite_candidates | awk '{print $1}' | tr '\n' ' ')" in
  *" $S "*) ok "a suite started as bash C:\\...\\tools\\run-tests.sh is seen by the suite name arm" ;;
  *) bad "a backslashed suite path was missed: [$(ps -ww -o command= -p "$S")]" ;; esac
kill "$S" 2>/dev/null; wait "$S" 2>/dev/null

# The Windows ancestor answer is kept in a file, so a check in another subshell (each poll of a wait is one, and the
# fixture filter runs on the right of a pipe) does not ask PowerShell again. A stand-in powershell.exe counts the calls.
mkdir -p "$T/fakeps"
printf '#!/bin/bash\necho x >> "%s/fakeps/calls"\necho "\\"C:\\\\nodejs\\\\node.exe\\" --test fake.test.js"\n' "$T" > "$T/fakeps/powershell.exe"
chmod +x "$T/fakeps/powershell.exe"
a1="$(PATH="$T/fakeps:$PATH"; _kosmos_win_native_ancestors "$$" 10; printf '%s' "$_KOSMOS_WIN_ANC")"
a2="$(PATH="$T/fakeps:$PATH"; _kosmos_win_native_ancestors "$$" 10; printf '%s' "$_KOSMOS_WIN_ANC")"
calls="$(grep -c x "$T/fakeps/calls" 2>/dev/null)"
[ "$a1" = "node --test fake.test.js" ] && [ "$a2" = "$a1" ] && [ "$calls" = 1 ] \
  && ok "a second check in another subshell reads the kept answer (PowerShell asked once, not twice)" \
  || bad "the Windows ancestor cache: calls=$calls(1) first=[$a1] second=[$a2]"
ls "$KOSMOS_RUN_MARKER_DIR/winanc/$$".* >/dev/null 2>&1 && ok "it is kept as winanc/<pid>.<winpid>.<start> in the marker dir" \
  || bad "no winanc file for $$ in $KOSMOS_RUN_MARKER_DIR"
printf 'node --test planted\n' > "$KOSMOS_RUN_MARKER_DIR/winanc/$DEAD.1.1"
( PATH="$T/fakeps:$PATH"; rm -f "$KOSMOS_RUN_MARKER_DIR/winanc/$$".*; _kosmos_win_native_ancestors "$$" 10 )
[ ! -e "$KOSMOS_RUN_MARKER_DIR/winanc/$DEAD.1.1" ] && ok "a kept answer for a gone pid is removed when one is written" \
  || bad "a winanc file for a gone pid was left"

# shell-parallel.sh's stop, in a shell that sourced this lib (as run-tests.sh does): ps -o ppid= now answers, so a live
# shard (this shell's child, leading its own group) is stopped, and a process this shell did not start is left alone,
# though it leads a group of its own and is named in the same list.
. tools/lib/shell-parallel.sh
start perl -e 'setpgrp(0, 0); select(undef, undef, undef, 60)'; OWN=$!
FOREIGN="$(bash -c 'perl -e "setpgrp(0, 0); select(undef, undef, undef, 60)" </dev/null >/dev/null 2>&1 & echo $!')"; PIDS="$PIDS $FOREIGN"
shows "$OWN" "perl *" && shows "$FOREIGN" "perl *" || bad "FIXTURE: the shard stand-ins never showed"
[ "$(ps -o ppid= -p "$FOREIGN")" != "$$" ] || bad "FIXTURE: the foreign stand-in is this shell's child"
KOSMOS_SHELL_PARALLEL_PIDS=" $OWN $FOREIGN"; KOSMOS_SHELL_PARALLEL_DONE=""; KOSMOS_SHELL_PARALLEL_DIR=""
kosmos_shell_parallel_stop 2>/dev/null
k=0; while kill -0 "$OWN" 2>/dev/null && [ "$k" -lt 30 ]; do sleep 0.1; k=$((k + 1)); done
if ! kill -0 "$OWN" 2>/dev/null && kill -0 "$FOREIGN" 2>/dev/null; then ok "shell-parallel's stop ends this shell's own shard and leaves a process it did not start"
else bad "shell-parallel stop: own shard $OWN alive=$(kill -0 "$OWN" 2>/dev/null && echo yes || echo no)(no), foreign $FOREIGN alive=$(kill -0 "$FOREIGN" 2>/dev/null && echo yes || echo no)(yes)"; fi
kill "$FOREIGN" 2>/dev/null

# --- review 2 -------------------------------------------------------------------
# A process that is there but whose command line cannot be read is a run pgrep cannot rule out: could not tell (2), not
# a skip. The seam reads one pid's command line as unreadable (a real case is an elevated Git Bash read from an
# unelevated one). A gone pid named by the seam changes nothing (the control).
start perl -e 'select(undef, undef, undef, 60)' "r2-$TAG"; U=$!
shows "$U" "perl *r2-$TAG" || bad "FIXTURE: the review 2 stand-in never showed"
KOSMOS_WIN_CMDLINE_UNREADABLE_PID="$U" pgrep -fa '^zz-no-such-command-7334$' >/dev/null; rc=$?
KOSMOS_WIN_CMDLINE_UNREADABLE_PID="$DEAD" pgrep -fa '^zz-no-such-command-7334$' >/dev/null; rc0=$?
[ "$rc" = 2 ] && [ "$rc0" = 1 ] && ok "a live process whose command line cannot be read makes pgrep -fa exit 2 (a gone one does not)" \
  || bad "unreadable command line: rc=$rc(2), gone-pid control rc=$rc0(1)"
out="$(KOSMOS_WIN_CMDLINE_UNREADABLE_PID="$U" _kosmos_suite_candidates)"; rc=$?
out2="$(KOSMOS_WIN_CMDLINE_UNREADABLE_PID="$U" kosmos_refuse_if_suite_live "this check" 2>&1)"; rc2=$?
[ "$rc" = 2 ] && [ "$rc2" = 1 ] && case "$out2" in *"could not tell"*) true ;; *) false ;; esac \
  && ok "and the suite check refuses with could not tell" || bad "unreadable command line, suite check: candidates rc=$rc(2), check rc=$rc2 [$out2]"
kill "$U" 2>/dev/null; wait "$U" 2>/dev/null

# The stand-in powershell.exe again, now printing what FAKEPS_OUT holds and exiting 0.
printf '#!/bin/bash\necho x >> "%s/fakeps/calls"\ncat "%s/fakeps/out"\n' "$T" "$T" > "$T/fakeps/powershell.exe"
anc() { ( PATH="$T/fakeps:$PATH"; _kosmos_win_native_ancestors "$1" 10; printf '%s' "$_KOSMOS_WIN_ANC" ); }
fresh() { rm -f "$T/fakeps/calls" "$KOSMOS_RUN_MARKER_DIR/winanc/"*; printf '%s' "$1" > "$T/fakeps/out"; }
# An unquoted program path with a space in it reads as the program, not as its first word.
fresh 'C:\Program Files\nodejs\node.exe --test x.test.js
'
got="$(anc "$$")"
[ "$got" = "node --test x.test.js" ] && ok "an unquoted C:\\Program Files\\...\\node.exe --test reads as node --test" || bad "unquoted spaced path: [$got]"
fresh 'C:\Windows\System32\cmd.exe /d /s /c "bash tools/run-tests.sh"
'
got="$(anc "$$")"
[ "$got" = 'cmd /d /s /c "bash tools/run-tests.sh"' ] && ok "CONTROL: an unquoted path with no space still reads as its first word" || bad "unquoted plain path: [$got]"
# An empty answer is kept only when Windows found the first parent; otherwise it is asked again.
fresh ''
anc "$$" >/dev/null; anc "$$" >/dev/null
c1="$(grep -c x "$T/fakeps/calls" 2>/dev/null)"
fresh '?kosmos-parent-seen
'
anc "$$" >/dev/null; got="$(anc "$$")"
c2="$(grep -c x "$T/fakeps/calls" 2>/dev/null)"
[ "$c1" = 2 ] && [ "$c2" = 1 ] && [ -z "$got" ] && ok "an empty answer is asked again unless the first parent was found (then kept, and empty)" \
  || bad "empty answer caching: no parent seen asked $c1 times (2), parent seen asked $c2 times (1), answer [$got]"
# A program whose name has a space keeps its real start in the key (stat's fields are counted after the name).
cp "$(command -v perl)" "$T/pe rl.exe" 2>/dev/null
start "$T/pe rl.exe" -e 'select(undef, undef, undef, 60)'; SP=$!
k=0; while ! grep -q '(pe rl)' "/proc/$SP/stat" 2>/dev/null && [ "$k" -lt 30 ]; do sleep 0.1; k=$((k + 1)); done
want="$(sed 's/.*) //' "/proc/$SP/stat" 2>/dev/null | awk '{print $20}')"
fresh 'node --test y.test.js
'
anc "$SP" >/dev/null
kept="$(ls "$KOSMOS_RUN_MARKER_DIR/winanc/" 2>/dev/null | grep "^$SP\.")"
[ -n "$want" ] && [ "${kept##*.}" = "$want" ] && ok "a program named with a space is kept under its real start ($want)" \
  || bad "spaced program name: kept [$kept], want start [$want], stat [$(cat "/proc/$SP/stat" 2>/dev/null)]"
kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null

echo "test-win-proctable-7334: $FAILS failed"
[ "$FAILS" = 0 ]
