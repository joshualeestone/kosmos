#!/bin/sh
# The clean-machine target (#224): walk the SERVED installer the way a
# stranger's Mac meets it, in a sandbox, before Josh does it live.
#
#   sh tools/clean-machine.sh                 # against installkosmos.com
#   HOST=http://127.0.0.1:8080 sh ...         # against a local server
#
# Three legs, in order, all against the script a stranger actually receives
# (fetched from HOST, never this repo's copy: testing the repo's file passes
# on a machine serving something older, which is the incident class this
# repo has already paid for three times):
#
#   CLEAN    a genuinely clean HOME has no Claude Code, and the installer
#            must install nothing, say nothing about it, and FINISH anyway
#            (#979). This description has been wrong twice: it still said
#            "refuse and stop" (#133) through the whole of #548, when the
#            leg beneath it was asserting the opposite. A header that
#            describes a retired ruling is read by whoever is deciding
#            whether a red leg is a real failure.
#   WALK     with Claude Code present (a stub at the path the product uses),
#            the full path runs: download, checksum, staging swap, bundle,
#            kosmos start, the board answering on the port with the version
#            the site says it serves.
#   REMOVAL  --uninstall in the same sandbox takes it all back down, the
#            port is freed, and NOTHING outside the sandbox changed: the
#            real shell profiles are checksummed before and after, and the
#            real LaunchAgents dir must hold exactly the plists it started
#            with. Uninstall is the path Rick's orphan chain came from.
#
# What this cannot see, said plainly (#224's other half): the TCC dialog's
# wording, Keychain, and a macOS account that has never run Claude Code.
# Those need a real second account, once, with one sudo from Josh.
#
# Sandboxing: HOME plus BOTH app-dir vars (KOSMOS_APP_DIR alone gates the
# destructive sites; KOSMOS_SYS_APP_DIR alone does not sandbox uninstall's
# home sweep, per setup.sh's own comment) plus KOSMOS_PORT. The trap kills
# every process the sandbox spawned, by state-path match, never by name.
set -u
HOST="${HOST:-https://installkosmos.com}"
SB="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-clean-XXXXXX")" || exit 1
FAILS=0
say()  { printf '%s\n' "$*"; }
pass() { say "PASS  $*"; }
fail() { say "FAIL  $*"; FAILS=$((FAILS+1)); }

# Real-machine witnesses, taken before anything runs.
prof_sum() {
  for f in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.zshenv" "$HOME/.profile" "$HOME/.bash_profile"; do
    [ -f "$f" ] && shasum -a 256 "$f"
  done
}
BEFORE_PROFILES="$(prof_sum)"
BEFORE_AGENTS="$(ls "$HOME/Library/LaunchAgents" 2>/dev/null | sort)"
# The launchd witness (#566): label AND registered plist path, snapshotted
# together, so the final check can tell a real job from a sandboxed test
# create instead of failing on every honest create-verification this Mac
# hosts. The judging rules live in the lib so the test drives the same code.
. "$(dirname "$0")/lib/launchd-witness.sh"
BEFORE_JOBS="$(lw_snapshot)"

kill_sandbox() {
  # Kill by state path, never by name: a name is a guess, the path is ours.
  for pid in $(pgrep -f "$SB" 2>/dev/null); do kill "$pid" 2>/dev/null; done
  sleep 1
  for pid in $(pgrep -f "$SB" 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
}
cleanup() {
  # KEEP preserves the DIRECTORY for inspection, never the processes: a
  # kept failed run must not leave a sandbox board listening forever.
  kill_sandbox
  if [ -n "${KEEP:-}" ]; then say "sandbox kept at $SB"; else rm -rf "$SB"; fi
}
trap cleanup EXIT
# INT/TERM must EXIT after cleaning, or a Ctrl+C mid-walk deletes the
# sandbox and the script then runs the remaining legs against nothing,
# printing a cascade of misleading FAILs before cleaning up again.
trap 'trap - EXIT INT TERM; cleanup; exit 130' INT TERM

# A free port WITHOUT binding it first: bind-and-close parks the port in
# TIME_WAIT (the macos-time-wait bulletin), the installer then finds its
# requested port busy and moves to an alternate, and the harness polls a
# port nothing listens on. Pick from the high range and check the listen
# table instead; the installer announces the port it REALLY used and the
# walk leg reads that announcement rather than trusting the request.
PORT=""
for _try in 1 2 3 4 5; do
  # ${RANDOM:-...}: under a non-bash sh RANDOM is unset and $$ is constant,
  # which would try ONE candidate five times; mix the loop counter in so the
  # retries are real everywhere.
  _cand=$(( ((${RANDOM:-$$} + _try * 7919) % 15000) + 40000 ))
  if ! lsof -iTCP:"$_cand" -sTCP:LISTEN >/dev/null 2>&1; then PORT="$_cand"; break; fi
done
[ -n "$PORT" ] || { fail "could not pick a port"; exit 1; }

say "== fetching the SERVED installer from $HOST =="
curl -fsSL "$HOST/setup" -o "$SB/setup" || { fail "could not fetch $HOST/setup"; exit 1; }
say "   $(wc -c < "$SB/setup" | tr -d ' ') bytes"

SBHOME="$SB/home"
# tmux keys its socket dir on UID under /tmp, NOT under HOME, so without
# this the sandboxed board reads the OPERATOR'S live tmux server; on a dev
# machine whose tmux is newer than the bundled one, that read fails with
# the version wall and the walk leg reports a defect a clean Mac does not
# have. An empty TMUX_TMPDIR is the clean-Mac state: no server, empty board.
mkdir -p "$SBHOME" "$SB/tmux-sock"
# run_setup <log-label> [real args...]: the label names the log only and is
# NEVER passed to the script (the first harness draft passed it through, the
# installer refused the unknown option, and every later leg then "passed"
# against a machine where nothing had been installed).
run_setup() {
  _label="$1"; shift
  # PATH is sanitized to the system's own: a fresh Mac has no ~/.local/bin
  # or homebrew on PATH, and without this the operator's real claude leaks
  # into `command -v` and the refusal leg exercises the wrong arm.
  # ⚠️ TMUX AND TMUX_PANE ARE UNSET, NOT JUST TMUX_TMPDIR SANDBOXED. This
  # harness runs inside the operator's tmux, $TMUX names the REAL server's
  # socket path directly, and a tmux client follows it past TMUX_TMPDIR:
  # measured, the sandboxed board listed the operator's sixteen live agents
  # through three layers of env. A stranger's installer never runs inside
  # tmux, and neither does this sandbox now.
  env -u TMUX -u TMUX_PANE \
  PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  HOME="$SBHOME" TMUX_TMPDIR="$SB/tmux-sock" \
  AGENT_WORKFORCE_LAUNCH="$SBHOME/Library/LaunchAgents" \
  KOSMOS_APP_DIR="$SB/app" KOSMOS_SYS_APP_DIR="$SB/Applications" \
  KOSMOS_PORT="$PORT" KOSMOS_NO_OPEN=1 \
  sh "$SB/setup" "$@" > "$SB/out.$_label.log" 2>&1
}

# 🛑 THIS LEG IS INVERTED AGAIN (#979, Josh 2026-08-26 10:32), and the header
# above it was one revision stale for the same reason. It has now asserted
# three different things: refuse the install (#133), carry and install it
# (#548), and now install NOTHING. Each time the product moved, this leg
# moved with it; leaving it asserting the old behaviour would turn a correct
# installer into a red release check and send the operator hunting the wrong
# thing -- and it runs against the SERVED artifact, so it fails late.
#
# ⚠️ THE CONTROL IS THE SAME AND IS STILL LOAD-BEARING: the sandbox HOME is
# asserted claude-less BEFORE the run, or a run that quietly took the
# found-it arm would satisfy every assertion below by doing nothing.
say "== CLEAN HOME: no Claude Code, so the installer installs nothing and finishes anyway =="
if [ -e "$SBHOME/.local/bin/claude" ]; then
  fail "the control is broken: the sandbox HOME already has a claude, so this leg would prove nothing"
fi
if run_setup clean; then
  pass "the install COMPLETED on a Mac with no Claude Code (an OpenAI-only person could not get past this before)"
  if [ -e "$SBHOME/.local/bin/claude" ]; then
    fail "something still installs Claude Code: it landed at $SBHOME/.local/bin/claude without being asked for"
  else
    pass "nothing was installed at $SBHOME/.local/bin/claude"
  fi
  # ⚠️ THE RETIRED SENTENCES, NOT THE WORD. A whole-log `grep -i claude` is
  # GUARANTEED to match on a correct installer: the permission-merge step
  # legitimately prints "(this answers Claude Code's one-time skip-permissions
  # question for this whole Mac" on its SUCCESS branch, which is the normal
  # path on a clean home. So that assertion could only ever pass when an
  # unrelated step failed -- inverted against reality, on the harness that runs
  # against the served artifact. What the ruling actually forbids is the check
  # step announcing a MISSING provider before one is chosen.
  if grep -qE "Installing it now|does not have it|We tried to install Claude Code" "$SB/out.clean.log"; then
    fail "the installer announced a missing provider before one was chosen; matched: $(grep -m1 -E 'Installing it now|does not have it|We tried to install Claude Code' "$SB/out.clean.log")"
  else
    pass "the retired install-Claude sentences are gone"
  fi
else
  fail "the installer DIED on a Mac with no Claude Code; tail: $(tail -2 "$SB/out.clean.log" | tr '\n' ' ')"
fi
# The carry leg ran a COMPLETE install (that is the point), so a sandbox
# board may now be listening. WALK must start from a stopped state or its
# run exercises the update-in-place and port-collision arms instead of the
# fresh path it asserts.
kill_sandbox

say "== WALK: Claude Code present, the whole served path =="
mkdir -p "$SBHOME/.local/bin"
printf '#!/bin/sh\nexit 0\n' > "$SBHOME/.local/bin/claude"
chmod 755 "$SBHOME/.local/bin/claude"
if run_setup walk; then
  pass "the served installer completed"
else
  fail "install failed; tail: $(tail -3 "$SB/out.walk.log" | tr '\n' ' ')"
fi
# The port the installer ANNOUNCED, which is the port that is true (the
# collision arm may have moved off the requested one, and the person is
# told the real address; the harness reads the same sentence).
GOT_PORT="$(sed -n 's|.*Your dashboard: http://127.0.0.1:\([0-9]*\).*|\1|p' "$SB/out.walk.log" | head -1)"
if [ -z "$GOT_PORT" ]; then
  fail "the installer never announced a dashboard address"
  GOT_PORT="$PORT"
elif [ "$GOT_PORT" != "$PORT" ]; then
  say "   note: requested port $PORT, installer chose $GOT_PORT (the collision arm)"
fi
# The board can take a few seconds to come up; poll rather than guess.
BOARD_JSON=""
for _i in 1 2 3 4 5 6 7 8 9 10; do
  BOARD_JSON="$(curl -fsS -m 3 "http://127.0.0.1:$GOT_PORT/api/status" 2>/dev/null || true)"
  [ -n "$BOARD_JSON" ] && break
  sleep 2
done
SERVED_VERSION="$(curl -fsS "$HOST/dist/latest.json" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
case "$BOARD_JSON" in
  \{*checkedAt*) pass "the board answers on port $GOT_PORT with a status body" ;;
  *)
    fail "no board status on port $GOT_PORT (body: $(printf %.60s "$BOARD_JSON"))"
    say "   diag: listeners on the port: $(lsof -iTCP:"$GOT_PORT" -sTCP:LISTEN 2>/dev/null | tail -1)"
    say "   diag: raw code: $(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$GOT_PORT/api/status" 2>/dev/null)"
    say "   diag: board.log tail: $(tail -3 "$SBHOME/.local/share/kosmos/logs/board.log" 2>/dev/null | tr '\n' ' | ')"
    ;;
esac
# The version the PAGE bakes at build time (meta name="kosmos-version"),
# which is the fact about the bundle that does not depend on the bundle's
# API; a source checkout leaves the placeholder, an installed bundle bakes
# the real number, and this run installed a bundle.
INSTALLED_VERSION="$(curl -fsS "http://127.0.0.1:$GOT_PORT/" 2>/dev/null | sed -n 's/.*name="kosmos-version" content="\([^"_][^"]*\)".*/\1/p' | head -1)"
if [ -n "$SERVED_VERSION" ] && [ "$INSTALLED_VERSION" = "$SERVED_VERSION" ]; then
  pass "installed version $INSTALLED_VERSION matches the site's latest.json"
else
  fail "version mismatch: installed '$INSTALLED_VERSION' vs served '$SERVED_VERSION'"
fi

say "== REMOVAL: --uninstall takes it back down =="
# Presence BEFORE absence: a removal leg run against a machine where the
# install failed passes every "gone" check vacuously and proves nothing.
if [ ! -e "$SB/app/Kosmos.app" ] && [ ! -e "$SB/Applications/Kosmos.app" ]; then
  fail "nothing installed to remove, so the removal leg would be vacuous; skipping its asserts"
  say ""
  say "CLEAN MACHINE: $FAILS failures; sandbox logs under $SB"
  exit "$FAILS"
fi
if run_setup uninstall --uninstall </dev/null; then
  pass "uninstall completed"
else
  fail "uninstall failed; tail: $(tail -3 "$SB/out.uninstall.log" | tr '\n' ' ')"
fi
sleep 1
if curl -fsS -m 2 "http://127.0.0.1:${GOT_PORT:-$PORT}/api/status" >/dev/null 2>&1; then
  fail "the board still answers after uninstall"
else
  pass "the port is quiet after uninstall"
fi
for d in "$SB/app/Kosmos.app" "$SB/Applications/Kosmos.app" "$SBHOME/.local/share/kosmos"; do
  if [ -e "$d" ]; then fail "uninstall left $d"; else pass "gone: ${d#$SB/}"; fi
done

say "== the real machine is untouched =="
AFTER_PROFILES="$(prof_sum)"
if [ "$BEFORE_PROFILES" = "$AFTER_PROFILES" ]; then
  pass "real shell profiles byte-identical"
else
  fail "a real shell profile CHANGED during the sandboxed run"
fi
AFTER_AGENTS="$(ls "$HOME/Library/LaunchAgents" 2>/dev/null | sort)"
if [ "$BEFORE_AGENTS" = "$AFTER_AGENTS" ]; then
  pass "real LaunchAgents unchanged"
else
  fail "real LaunchAgents changed: $(printf '%s\n%s' "$BEFORE_AGENTS" "$AFTER_AGENTS" | sort | uniq -u | tr '\n' ' ')"
fi
# The DOMAIN, not only the files: launchd has no sandbox, and a run of this
# very harness once bootstrapped its temp-pathed plist over the product's
# real label while the file check above stayed green. Serving and
# supervised are different properties, and the label's registered path is
# the one a file listing cannot see.
AFTER_LABEL="$(launchctl print "gui/$(id -u)/com.kosmos.board" 2>/dev/null | sed -n 's/.*path = //p' | head -1)"
case "$AFTER_LABEL" in
  ''|"$HOME"/Library/LaunchAgents/*) pass "the real board label points nowhere near the sandbox" ;;
  *) fail "the real com.kosmos.board label now points at $AFTER_LABEL" ;;
esac
# And EVERY com.kosmos label, not only the board: the uninstall path also
# manages com.kosmos.agent.* jobs, and a sandbox-registered agent label
# would slip every file witness for the same reason the board's did.
#
# ⚠️ JUDGED BY PLIST PATH, NOT BY LABEL EQUALITY (#566). launchd has one gui
# domain, so any honest create-and-chat verification on this Mac bootstraps
# a real com.kosmos.agent.* job into it even when its store is sealed -- the
# strict equality failed on every such run, forever. The lib names each
# changed job REAL / OURS / SANDBOX / UNKNOWN; only the first, second and
# fourth fail. A SANDBOX job is somebody else's test create: ignored, and
# SAID, because a transient job must read as "observed, ignored" rather
# than as silence -- while ignoring OURS would let this harness's own
# uninstall leak hide behind the same word.
AFTER_JOBS="$(lw_snapshot)"
if [ "$BEFORE_JOBS" = "$AFTER_JOBS" ]; then
  pass "the launchd domain holds the same com.kosmos jobs it started with"
else
  LW_REAL_CHANGES=0
  while IFS=' ' read -r _kind _label _path; do
    [ -n "$_kind" ] || continue
    case "$_kind" in
      REAL)    fail "a REAL com.kosmos job changed during the run: $_label ($_path)"; LW_REAL_CHANGES=1 ;;
      OURS)    fail "uninstall left this sandbox's job registered in launchd: $_label ($_path)"; LW_REAL_CHANGES=1 ;;
      UNKNOWN) fail "a com.kosmos job appeared or vanished too fast to read where it was registered from: $_label; rerun to be sure"; LW_REAL_CHANGES=1 ;;
      SANDBOX) say "   sandboxed create observed elsewhere on this Mac, ignored: $_label (plist at $_path, not ~/Library/LaunchAgents)" ;;
    esac
  done <<LWEOF
$(lw_judge "$BEFORE_JOBS" "$AFTER_JOBS" "$HOME/Library/LaunchAgents" "$SB")
LWEOF
  if [ "$LW_REAL_CHANGES" -eq 0 ]; then
    pass "the launchd domain's changes were all sandboxed test creates, named above"
  fi
fi

say ""
if [ "$FAILS" -eq 0 ]; then
  say "CLEAN MACHINE OK: refusal, walk and removal all behave on the script a stranger receives"
else
  say "CLEAN MACHINE: $FAILS failures; logs in $SB are removed unless KEEP=1 was set"
fi
exit "$FAILS"
