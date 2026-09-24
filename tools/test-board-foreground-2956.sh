#!/bin/bash
# #2956: drive the REAL `kosmos board-run` (the supervised foreground entry) in a
# fake KOSMOS_HOME, asserting the three things the supervisor depends on:
#   1. a deliberate stop (the #2955 marker) is honored even on the RunAtLoad race
#      -- board-run exits 0 and never execs node;
#   2. with no marker, board-run records the pidfile as the pid node will run as
#      (it writes $$ then `exec`s node IN PLACE, so node keeps that pid) -- this
#      is what keeps `kosmos stop`/`status` (pidfile-based) working under a
#      supervisor -- and passes PORT through;
#   3. an incomplete install (missing runtime) fails loud, non-zero, no node.
#
# The stub `node` is `exec`ed by board-run, so it becomes the final process and
# its own $$ IS the pid board-run wrote to the pidfile -- the test asserts they
# match, which is the whole load-bearing claim.
set -u
cd "$(dirname "$0")/.." || exit 1
KOSMOS="$PWD/install/kosmos"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

# A throwaway KOSMOS_HOME laid out like the installed bundle: a stub runtime node,
# a stub app, a stub bundled tmux (present+executable so board-run's integrity
# check passes; never actually invoked here).
new_home() {
  local h; h="$(mktemp -d)"
  mkdir -p "$h/runtime/bin" "$h/app" "$h/tmux/bin" "$h/logs"
  # The stub node records that it ran, whether the pidfile already named ITS pid
  # (proving board-run wrote $$ before exec), and the PORT it inherited.
  cat > "$h/runtime/bin/node" <<'NODE'
#!/bin/bash
H="${KOSMOS_HOME:?}"
recorded="$(cat "$H/board.pid" 2>/dev/null || echo MISSING)"
if [ "$recorded" = "$$" ]; then match=match; else match="mismatch(pidfile=$recorded,node=$$)"; fi
printf 'ran pid=%s pidfile=%s %s port=%s\n' "$$" "$recorded" "$match" "${PORT:-UNSET}" > "$H/.node-ran"
exit 0
NODE
  chmod +x "$h/runtime/bin/node"
  : > "$h/app/server.js"
  printf '#!/bin/bash\nexit 1\n' > "$h/tmux/bin/tmux"   # present+executable; only existence matters here
  chmod +x "$h/tmux/bin/tmux"
  printf '%s' "$h"
}

# Run board-run against a home, with a tmux-free PATH and the known-tmux seam
# emptied so install/kosmos's tmux picker falls to the (stub) bundled copy rather
# than finding this box's real tmux. Returns board-run's exit code; output hushed.
run_br() {
  local h="$1"
  PATH=/usr/bin:/bin KOSMOS_TMUX_KNOWN="" KOSMOS_HOME="$h" KOSMOS_PORT=17777 \
    /bin/bash "$KOSMOS" board-run >/dev/null 2>&1
}

# 1. Deliberate-stop marker present -> exit 0, node NEVER exec'd, no pidfile.
H="$(new_home)"; : > "$H/board.stopped"
run_br "$H"; rc=$?
[ "$rc" = 0 ] && ok "marker present: exits 0" || bad "marker present: exit $rc (want 0)"
[ ! -f "$H/.node-ran" ] && ok "marker present: node not started" || bad "marker present: node ran anyway ($(cat "$H/.node-ran"))"
[ ! -f "$H/board.pid" ] && ok "marker present: no pidfile written" || bad "marker present: wrote a pidfile"
rm -rf "$H"

# 2. No marker -> node exec'd, pidfile == node's own pid, PORT passed through.
H="$(new_home)"
run_br "$H"; rc=$?
[ "$rc" = 0 ] && ok "no marker: exits 0 (node ran)" || bad "no marker: exit $rc"
if [ -f "$H/.node-ran" ]; then
  ok "no marker: node started"
  grep -q ' match ' "$H/.node-ran" \
    && ok "no marker: pidfile names the pid node runs as (exec kept \$\$)" \
    || bad "no marker: pidfile != node pid -> $(cat "$H/.node-ran")"
  grep -q 'port=17777' "$H/.node-ran" \
    && ok "no marker: PORT propagated to node" \
    || bad "no marker: PORT not propagated -> $(cat "$H/.node-ran")"
else
  bad "no marker: node never ran"
fi
rm -rf "$H"

# 3. Incomplete install (runtime missing) -> non-zero, node never ran.
H="$(new_home)"; rm -f "$H/runtime/bin/node"
run_br "$H"; rc=$?
[ "$rc" != 0 ] && ok "missing runtime: fails non-zero" || bad "missing runtime: exit 0 (want non-zero)"
[ ! -f "$H/.node-ran" ] && ok "missing runtime: node not started" || bad "missing runtime: node ran"
rm -rf "$H"

# 4. A foreign healthy board already serves the port (the fresh-install RunAtLoad
# collision, #2956): board-run must DEFER -- exit 0, leave the pidfile untouched,
# and never exec node -- instead of clobbering the pidfile and exec'ing a doomed
# second node onto the taken port. Needs a real HTTP server on the port (healthy()
# curls it), so this uses the system node; skipped if none is available.
NODE_BIN="$(command -v node 2>/dev/null || true)"

# start_holder <http|net> <body> <host>: start a port holder on a port the OS picks
# (listen 0) and set SRV (its pid) and HOLDER_PORT (the port it got). #3616: these
# arms used fixed ports, and on a Mac where several agents run the suite at once the
# holder of one run hit EADDRINUSE on another run's holder; this run's lsof/curl wait
# then saw the OTHER run's listener, and board-run started node once that one exited.
# HOLDER_PORT is empty when the holder did not start; the arm then fails rather than
# asserting against a port it does not own.
start_holder() {
  local pf; pf="$(mktemp "${TMPDIR:-/tmp}/holder-port.XXXXXXXXXX")" || { SRV=""; HOLDER_PORT=""; return 1; }
  "$NODE_BIN" -e 'const [kind, body, host, pf] = process.argv.slice(1);
    const s = kind === "http" ? require("http").createServer((_, r) => r.end(body)) : require("net").createServer(() => {});
    s.listen(0, host, () => require("fs").writeFileSync(pf, String(s.address().port)));' "$1" "$2" "$3" "$pf" &
  SRV=$!
  HOLDER_PORT=""
  for _i in $(seq 1 50); do [ -s "$pf" ] && { HOLDER_PORT="$(cat "$pf")"; break; }; sleep 0.1; done
  rm -f "$pf"
  [ -n "$HOLDER_PORT" ]
}
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  H="$(new_home)"
  if start_holder http "Kosmos board" 127.0.0.1; then
    PORTX=$HOLDER_PORT
    for i in $(seq 1 40); do /usr/bin/curl -fsS -m1 "http://127.0.0.1:$PORTX/" >/dev/null 2>&1 && break; sleep 0.1; done
    printf 'SENTINEL-4242' > "$H/board.pid"
    PATH=/usr/bin:/bin KOSMOS_TMUX_KNOWN="" KOSMOS_HOME="$H" KOSMOS_PORT=$PORTX /bin/bash "$KOSMOS" board-run >/dev/null 2>&1; rc=$?
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
    [ "$rc" = 0 ] && ok "foreign healthy board: board-run exits 0 (defers)" || bad "foreign healthy board: exit $rc (want 0)"
    [ "$(cat "$H/board.pid" 2>/dev/null)" = "SENTINEL-4242" ] && ok "foreign healthy board: pidfile NOT clobbered" || bad "foreign healthy board: pidfile clobbered -> $(cat "$H/board.pid" 2>/dev/null)"
    [ ! -f "$H/.node-ran" ] && ok "foreign healthy board: node not exec'd (no doomed second bind)" || bad "foreign healthy board: node ran anyway"
  else
    bad "foreign healthy board: holder did not start (no port to test against)"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  fi
  rm -rf "$H"
else
  echo "SKIP  foreign-healthy-board case (no system node to run a stub server)"
fi

# 5. A STRANGER (non-Kosmos) permanently holds the port: board-run must NOT exec
# node into a doomed EADDRINUSE crash-loop -- it exits without spawning node or
# clobbering the pidfile. Server serves a body that is NOT our identity string, so
# healthy() is false but port_taken_by_stranger is true.
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  H="$(new_home)"
  if start_holder http "some other app" 127.0.0.1; then
    PORTY=$HOLDER_PORT
    for i in $(seq 1 40); do /usr/bin/curl -fsS -m1 "http://127.0.0.1:$PORTY/" >/dev/null 2>&1 && break; sleep 0.1; done
    printf 'SENTINEL-7777' > "$H/board.pid"
    PATH=/usr/bin:/bin KOSMOS_TMUX_KNOWN="" KOSMOS_HOME="$H" KOSMOS_PORT=$PORTY /bin/bash "$KOSMOS" board-run >/dev/null 2>&1; rc=$?
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
    [ "$rc" = 0 ] && ok "stranger on port: board-run exits 0 (no doomed exec)" || bad "stranger on port: exit $rc (want 0)"
    [ ! -f "$H/.node-ran" ] && ok "stranger on port: node not exec'd (no crash-loop)" || bad "stranger on port: node ran into EADDRINUSE"
    [ "$(cat "$H/board.pid" 2>/dev/null)" = "SENTINEL-7777" ] && ok "stranger on port: pidfile NOT clobbered" || bad "stranger on port: pidfile clobbered"
  else
    bad "stranger on port: holder did not start (no port to test against)"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  fi
  rm -rf "$H"
else
  echo "SKIP  stranger-on-port case (no system node)"
fi

# 6. A SILENT holder (#2988): a process BINDS the port but answers NO HTTP -- the
# #2955 half-dead/zombie case. healthy() and port_taken_by_stranger() BOTH need an
# HTTP response, so both read false; only port_has_listener() (lsof) sees it, so
# board-run must still DEFER -- exit 0, no node exec, pidfile untouched -- rather
# than fall through to a doomed EADDRINUSE crash-loop. Uses a raw TCP listener
# (node `net`, which accepts but never answers) and lsof. The guard itself fails
# OPEN without lsof, so the case is skipped when /usr/sbin/lsof is absent -- matching
# that fall-through, not asserting a defer the guard cannot make. NOTE the board-run
# line runs with PATH=/usr/bin:/bin (no /usr/sbin), which is exactly why the guard
# calls lsof by its absolute path.
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] && [ -f /usr/sbin/lsof ] && [ -x /usr/sbin/lsof ]; then
  H="$(new_home)"
  if start_holder net "" 127.0.0.1; then
    PORTZ=$HOLDER_PORT
    for i in $(seq 1 40); do /usr/sbin/lsof -nP -iTCP:$PORTZ -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 0.1; done
    printf 'SENTINEL-8888' > "$H/board.pid"
    PATH=/usr/bin:/bin KOSMOS_TMUX_KNOWN="" KOSMOS_HOME="$H" KOSMOS_PORT=$PORTZ /bin/bash "$KOSMOS" board-run >/dev/null 2>&1; rc=$?
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
    [ "$rc" = 0 ] && ok "silent holder: board-run exits 0 (defers)" || bad "silent holder: exit $rc (want 0)"
    [ ! -f "$H/.node-ran" ] && ok "silent holder: node not exec'd (no EADDRINUSE crash-loop)" || bad "silent holder: node ran into EADDRINUSE"
    [ "$(cat "$H/board.pid" 2>/dev/null)" = "SENTINEL-8888" ] && ok "silent holder: pidfile NOT clobbered" || bad "silent holder: pidfile clobbered"
  else
    bad "silent holder: holder did not start (no port to test against)"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  fi
  rm -rf "$H"
else
  echo "SKIP  silent-holder case (needs system node + /usr/sbin/lsof)"
fi

# 7. A SILENT holder on * / 0.0.0.0 (#2988): the board binds 127.0.0.1, and a
# listener on * (all interfaces) DOES collide with that bind, so board-run must
# still DEFER. This guards the specific mistake of scoping the lsof query to
# `@127.0.0.1`: a * bind shows as `*:PORT`, which that form MISSES (measured),
# re-opening the crash-loop. (The mirror case -- a specific NON-loopback bind such
# as a LAN IP must NOT defer -- needs a stable non-loopback address the test cannot
# assume across machines/CI, so it is verified manually (2026-09-13), not here.)
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] && [ -f /usr/sbin/lsof ] && [ -x /usr/sbin/lsof ]; then
  H="$(new_home)"
  if start_holder net "" 0.0.0.0; then
    PORTW=$HOLDER_PORT
    for i in $(seq 1 40); do /usr/sbin/lsof -nP -iTCP:$PORTW -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 0.1; done
    printf 'SENTINEL-9999' > "$H/board.pid"
    PATH=/usr/bin:/bin KOSMOS_TMUX_KNOWN="" KOSMOS_HOME="$H" KOSMOS_PORT=$PORTW /bin/bash "$KOSMOS" board-run >/dev/null 2>&1; rc=$?
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
    [ "$rc" = 0 ] && ok "all-interfaces (*) holder: board-run exits 0 (defers)" || bad "all-interfaces (*) holder: exit $rc (want 0)"
    [ ! -f "$H/.node-ran" ] && ok "all-interfaces (*) holder: node not exec'd (no EADDRINUSE crash-loop)" || bad "all-interfaces (*) holder: node ran into EADDRINUSE"
    [ "$(cat "$H/board.pid" 2>/dev/null)" = "SENTINEL-9999" ] && ok "all-interfaces (*) holder: pidfile NOT clobbered" || bad "all-interfaces (*) holder: pidfile clobbered"
  else
    bad "all-interfaces (*) holder: holder did not start (no port to test against)"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  fi
  rm -rf "$H"
else
  echo "SKIP  all-interfaces-holder case (needs system node + /usr/sbin/lsof)"
fi

if [ "$fails" = 0 ]; then echo "ALL PASS (test-board-foreground-2956)"; else echo "FAILURES (test-board-foreground-2956)"; fi
exit "$fails"
