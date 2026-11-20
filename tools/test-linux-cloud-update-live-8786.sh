#!/bin/bash
# kosmos#8786 S2: the Cloud box's nightly update units on REAL systemd (GitHub's ubuntu runner, linux-systemd.yml).
# Measures, with the real engine/linuxboard.js installBoard and removeBoard, the real Cloud latch and the real
# install/kosmos cloud-update:
#   1. CONTROL: with no latch, installBoard writes no nightly unit;
#   2. with the latch, it writes both units, systemd accepts them (systemd-analyze verify) and the timer is enabled;
#   3. the service, started by systemd, runs the real chain (unit -> install/kosmos cloud-update -> cloudnightly.js)
#      and logs why it skipped: here the signed check, since this home has no installed verifier;
#   4. with the Updates switch off it logs that reason instead (the off switch reaches the nightly run);
#   5. with the latch gone it skips QUIETLY: no new line;
#   5b. an install run with ANOTHER user's XDG_RUNTIME_DIR still enables the timer (kosmos#8786);
#   6. removeBoard takes both units away.
# It installs nothing: no case here reaches the update look. The board is the #4918 test's stub.
set -uo pipefail
[ -n "${CI:-}" ] && [ -n "${GITHUB_ACTIONS:-}" ] || { echo "refusing: this test changes the real user systemd; it runs on GitHub Actions only (CI and GITHUB_ACTIONS set)" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1   # every node -e requires ./engine/..., relative to here
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

U="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$U}"
_um_state="$(systemctl --user is-system-running 2>/dev/null || true)"
if [ "$_um_state" != "running" ] && [ "$_um_state" != "degraded" ]; then
  echo "FAIL  no systemd user manager ($_um_state); the workflow's linger step sets it up"; exit 1
fi

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test-cloud-update-8786.XXXXXXXXXX")" || { echo "FAIL  no temp dir"; exit 1; }
[ -n "$ROOT" ] && [ -d "$ROOT" ] || { echo "FAIL  no temp dir"; exit 1; }
H="$ROOT/kosmos-home"
STATE="$ROOT/tunnel-state"   # the tunnel's state folder, where the Cloud latch lives (cloudmachine.js)
DATA="$ROOT/data"            # the board's data root (the Updates switch, the board token)
mkdir -p "$H/bin" "$H/logs" "$H/runtime/bin" "$STATE" "$DATA"
# install/kosmos's kosmos_engine_node takes $KOSMOS_HOME/runtime/bin/node first, as on an install; here it is the job's
# node (setup-node), not whatever node the unit's PATH would find.
ln -s "$(command -v node)" "$H/runtime/bin/node"
# The engine the CLI finds (kosmos_engine_module falls back to $KOSMOS_HOME/engine): this checkout's.
ln -s "$REPO/engine" "$H/engine"
cat > "$H/bin/kosmos" <<SH
#!/bin/bash
if [ "\${1:-}" = "board-run" ]; then
  [ -f "\$KOSMOS_HOME/board.stopped" ] && exit 0
  while true; do sleep 1; done
fi
exec /bin/bash "$REPO/install/kosmos" "\$@"
SH
chmod +x "$H/bin/kosmos"

# The services see the user manager's environment: point the latch and the data root at this test's folders.
systemctl --user set-environment AGENT_WORKFORCE_TUNNEL_STATE="$STATE" AGENT_WORKFORCE_DATA="$DATA"
export AGENT_WORKFORCE_TUNNEL_STATE="$STATE" AGENT_WORKFORCE_DATA="$DATA"

BOARD="$(node -e 'console.log(require("./engine/linuxboard").boardUnitName(process.argv[1]))' "$H")"
TIMER="$(node -e 'console.log(require("./engine/linuxboard").cloudUpdateNames(process.argv[1]).timer)' "$H")"
PTIMER="$(node -e 'console.log(require("./engine/linuxboard").pauseCheckNames(process.argv[1]).timer)' "$H")"
PSVC="$(node -e 'console.log(require("./engine/linuxboard").pauseCheckNames(process.argv[1]).service)' "$H")"
SVC="$(node -e 'console.log(require("./engine/linuxboard").cloudUpdateNames(process.argv[1]).service)' "$H")"
DIR="$HOME/.config/systemd/user"
cleanup() {
  node -e 'require("./engine/linuxboard").removeBoard(process.argv[1])' "$H" >/dev/null 2>&1 || true
  for u in "$TIMER" "$SVC" "$PTIMER" "$PSVC" "$BOARD"; do
    systemctl --user disable --now "$u" >/dev/null 2>&1 || true
    systemctl --user reset-failed "$u" >/dev/null 2>&1 || true
    rm -f "$DIR/$u" "$DIR/timers.target.wants/$u"
  done
  systemctl --user unset-environment AGENT_WORKFORCE_TUNNEL_STATE AGENT_WORKFORCE_DATA >/dev/null 2>&1 || true
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  rm -rf "${ROOT:?}"
}
trap cleanup EXIT

install_board() {
  node -e '
    const r = require("./engine/linuxboard").installBoard(process.argv[1], 18890);
    console.log(JSON.stringify(r && r.cloudUpdate));
    if (!r || r.ok !== true) process.exit(3);
  ' "$H"
}

# --- 1. CONTROL: no latch, no nightly unit ------------------------------------------------------------------------
out="$(install_board)" || bad "installBoard failed without the latch: $out"
[ "$out" = null ] && [ ! -e "$DIR/$TIMER" ] && [ ! -e "$DIR/$SVC" ] \
  && ok "CONTROL: without the Cloud latch installBoard writes no nightly unit" \
  || bad "without the latch: cloudUpdate=$out, timer file $([ -e "$DIR/$TIMER" ] && echo present || echo absent)"

# --- 2. The latch: both units, accepted by systemd, the timer enabled -----------------------------------------------
: > "$STATE/hosted"
out="$(install_board)" || bad "installBoard failed with the latch: $out"
[ "$out" = '{"ok":true}' ] && [ -f "$DIR/$TIMER" ] && [ -f "$DIR/$SVC" ] \
  && ok "with the latch installBoard writes the nightly service and timer ($SVC, $TIMER)" \
  || bad "with the latch: cloudUpdate=$out"
[ "$(systemctl --user is-enabled "$TIMER" 2>/dev/null)" = enabled ] && systemctl --user is-active "$TIMER" >/dev/null 2>&1 \
  && ok "the nightly timer is enabled and running" || bad "the nightly timer is not enabled and running"
if command -v systemd-analyze >/dev/null 2>&1; then
  v="$(systemd-analyze --user verify "$DIR/$SVC" "$DIR/$TIMER" 2>&1)"; vrc=$?
  [ "$vrc" = 0 ] && ok "systemd-analyze verify accepts both units" || bad "systemd-analyze verify (rc $vrc): $v"
else
  bad "systemd-analyze is not installed, so the units were not verified"
fi
next="$(systemctl --user show -p NextElapseUSecRealtime --value "$TIMER" 2>/dev/null)"
[ -n "$next" ] && ok "the timer has a next firing ($next)" || bad "the timer has no next firing"

# run_service: start the oneshot (start returns when it has finished) and print "ran" only when systemd really ran a
# NEW invocation that exited 0. Result=success alone is also what a unit never started reports, so it proves nothing.
run_service() {
  local before after rc st
  before="$(systemctl --user show -p InvocationID --value "$SVC" 2>/dev/null)"
  systemctl --user start "$SVC" 2>/dev/null; rc=$?
  after="$(systemctl --user show -p InvocationID --value "$SVC" 2>/dev/null)"
  st="$(systemctl --user show -p ExecMainStatus --value "$SVC" 2>/dev/null)"
  if [ "$rc" = 0 ] && [ -n "$after" ] && [ "$after" != "$before" ] && [ "$st" = 0 ]; then echo ran
  else echo "not-run(start rc $rc, invocation ${before:-none} -> ${after:-none}, status $st)"; fi
}
LOG="$H/logs/install.log"
lines() { local n; n="$(grep -c 'cloud-update:' "$LOG" 2>/dev/null)"; echo "${n:-0}"; }

# --- 3. Started by systemd, the real chain runs and says why it skipped ---------------------------------------------
res="$(run_service)"
[ "$res" = ran ] && ok "systemd ran the nightly service and it exited 0" || bad "the nightly service: $res"
grep -q 'cloud-update: skipped tonight: the signature check is not available' "$LOG" 2>/dev/null \
  && ok "it logged the skip: no signed check in this home" \
  || bad "no signed-check skip line; install.log: $(tail -3 "$LOG" 2>/dev/null | tr '\n' '|')"

# --- 4. The Updates switch off reaches the nightly run ---------------------------------------------------------------
node -e 'const r = require("./engine/autoupdate").write({ on: false }); if (!r.ok) process.exit(3)' || bad "could not turn the Updates switch off"
res="$(run_service)"
[ "$res" = ran ] && grep -q 'cloud-update: skipped tonight: updates are turned off in Settings' "$LOG" 2>/dev/null \
  && ok "with the Updates switch off it logged that reason" \
  || bad "the switch-off run: result $res, install.log: $(tail -2 "$LOG" 2>/dev/null | tr '\n' '|')"

# --- 5. The latch gone: a quiet skip ---------------------------------------------------------------------------------
rm -f "$STATE/hosted"
before="$(lines)"
res="$(run_service)"
after="$(lines)"
[ "$res" = ran ] && [ "$after" = "$before" ] \
  && ok "without the latch the run skips quietly (no new line)" \
  || bad "the latch-gone run: result $res, cloud-update lines $before -> $after"

# --- 5b. A FOREIGN XDG_RUNTIME_DIR (kosmos#8786, measured on a Hetzner box): an install run with a root-owned folder in ---
# XDG_RUNTIME_DIR, as a root login passes its own through `runuser`, must still enable the timer. Before the fix installBoard
# reached no bus ("Failed to connect to bus") and left the units written but disabled. The CONTROL below proves this runner's
# systemctl --user really fails with that folder, so a pass here is the fix and not a bus found some other way.
FOREIGN="$ROOT/foreign-rt"
if [ "$(id -u)" = 0 ]; then echo "SKIP  5b: run as root, a root-owned folder is this user's own"
elif sudo -n mkdir -p "$FOREIGN" 2>/dev/null && sudo -n chown root:root "$FOREIGN" 2>/dev/null; then
  # show-environment exits 0 whenever the bus answers (is-system-running would also fail on a merely degraded manager).
  XDG_RUNTIME_DIR="$FOREIGN" systemctl --user show-environment >/dev/null 2>&1 \
    && bad "CONTROL: systemctl --user still reaches a bus with the root-owned folder, so 5b cannot show the fix" \
    || ok "CONTROL: with the root-owned folder, systemctl --user reaches no bus (the measured failure)"
  : > "$STATE/hosted"
  systemctl --user disable --now "$TIMER" >/dev/null 2>&1 || true
  [ "$(systemctl --user is-enabled "$TIMER" 2>/dev/null)" != enabled ] || bad "premise: the timer is still enabled before the foreign-folder install"
  out="$(XDG_RUNTIME_DIR="$FOREIGN" install_board)" || bad "installBoard failed with a foreign XDG_RUNTIME_DIR: $out"
  [ "$out" = '{"ok":true}' ] && [ "$(systemctl --user is-enabled "$TIMER" 2>/dev/null)" = enabled ] \
    && ok "with another user's XDG_RUNTIME_DIR the install still enables the nightly timer" \
    || bad "foreign XDG_RUNTIME_DIR: cloudUpdate=$out, timer $(systemctl --user is-enabled "$TIMER" 2>/dev/null)"
  sudo -n rm -rf "${FOREIGN:?}" 2>/dev/null || true   # if not, the EXIT trap removes it: an empty folder in our own $ROOT
else
  bad "premise: could not make a root-owned folder with sudo -n (the runner has passwordless sudo)"
fi

# --- 6. removeBoard takes both units away ----------------------------------------------------------------------------
node -e 'const r = require("./engine/linuxboard").removeBoard(process.argv[1]); if (!r.ok) { console.error(JSON.stringify(r)); process.exit(3); }' "$H" \
  || bad "removeBoard refused"
[ ! -e "$DIR/$TIMER" ] && [ ! -e "$DIR/$SVC" ] && [ ! -L "$DIR/timers.target.wants/$TIMER" ] \
  && ! systemctl --user is-active "$TIMER" >/dev/null 2>&1 \
  && ok "removeBoard took the nightly timer and service away" || bad "the nightly units are still there after removeBoard"

[ "$fails" = 0 ] && echo "ALL PASS (kosmos#8786 S2 on real systemd)" || echo "SOME FAILED"
exit "$fails"
