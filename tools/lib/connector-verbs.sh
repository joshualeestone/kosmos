#!/bin/bash
# Does the Plus connector the bundle is about to ship know the verbs the board
# will ask it for? (#718)
#
# Turning phone notifications on makes the board run `kosmos-tunnel mac-request`
# (engine/phonenotify.js through engine/remote.js). A tunnel built before
# kosmos-relay #103 answers "unrecognized subcommand", and the board then tells
# the person their Kosmos needs an update. The default input,
# ~/work/kosmos-relay/dist/kosmos-tunnel, is a local build that can be that old.
#
# The ship gate decides how loud this is. While PHONE_APP_CAN_RECEIVE is false
# nothing calls mac-request, so an old connector is harmless: one quiet line.
# Once it is true, bundling an old connector ships a switch that cannot turn
# on, so the build refuses.
#
# Usage: source, then `connector_verbs_check <tunnel-bin> <phonenotify.js>`.
# Returns 0 to go on (maybe after the one-line note), 1 to refuse, with the
# reason on stderr.

# Prints true or false from the gate's one declaration line, or nothing when
# that line cannot be found. The line is matched exactly, so a reworded gate
# is noticed rather than guessed at.
connector_gate_value() {
  local line
  line="$(grep -E '^const PHONE_APP_CAN_RECEIVE = (true|false);[[:space:]]*$' "$1" 2>/dev/null | head -1)" || true
  case "$line" in
    *'= true;'*) echo true ;;
    *'= false;'*) echo false ;;
    *) : ;;
  esac
}

# Runs `<bin> mac-request --help` with a time bound and says which of three
# things happened: "has" (exit 0), "old"
# (exit 2 with clap's "unrecognized subcommand"), or "unknown: <why>" for
# anything else. Only "old" is evidence the connector predates the verb; a file
# that is missing, is not executable, is killed by Gatekeeper, crashes or hangs
# is a different problem with a different fix.
#
# The bound is CONNECTOR_PROBE_SECONDS, default 20: `--help` answers at once, so
# the bound exists only to stop a hang, and 20 leaves room for a first launch's
# signature check. Anything but a positive whole number falls back to 20, because
# perl's `alarm 0` would switch the bound off.
#
# The bound: perl (macOS has no `timeout`) starts the connector in its own
# process group and kills the whole group when time runs out, so a connector
# that starts a child cannot outlive it. Its stderr goes to a file, not a pipe,
# because a pipe capture waits for every process still holding the pipe.
connector_probe_seconds() {
  case "${CONNECTOR_PROBE_SECONDS:-}" in ''|*[!0-9]*) echo 20 ;; *) [ "$CONNECTOR_PROBE_SECONDS" -gt 0 ] && echo "$CONNECTOR_PROBE_SECONDS" || echo 20 ;; esac
}

connector_mac_request_probe() {
  local bin="$1" errf err rc secs
  secs="$(connector_probe_seconds)"
  if [ ! -e "$bin" ]; then echo "unknown: there is no file at $bin"; return; fi
  if [ ! -x "$bin" ]; then echo "unknown: $bin is not executable"; return; fi
  if ! command -v perl >/dev/null 2>&1; then echo "unknown: perl is not installed, so the connector could not be run under a time limit"; return; fi
  errf="$(mktemp "${TMPDIR:-/tmp}/connector-probe.XXXXXX")" || { echo "unknown: could not make a temp file for the probe"; return; }
  # Inside an `if`, so a failing probe never trips a caller's `set -e`.
  if perl -e '
      my $secs = shift;
      my $pid = fork();
      die "fork failed\n" unless defined $pid;
      if ($pid == 0) { setpgrp(0, 0); exec @ARGV or exit 127; }
      # Set the group from the parent too, so a timeout that fires before the
      # child has run setpgrp still has a group to kill.
      setpgrp($pid, $pid);
      local $SIG{ALRM} = sub {
        print STDERR "connector-probe: timed out\n";
        kill "KILL", -$pid; kill "KILL", $pid; waitpid($pid, 0); exit 142;
      };
      alarm $secs;
      waitpid($pid, 0);
      my $st = $?;
      exit(($st & 127) ? 128 + ($st & 127) : ($st >> 8));
    ' "$secs" "$bin" mac-request --help >/dev/null 2>"$errf"; then rc=0; else rc=$?; fi
  err="$(head -1 "$errf" 2>/dev/null)" || true
  if [ "$rc" = 142 ] && grep -q "^connector-probe: timed out$" "$errf" 2>/dev/null; then rm -f "$errf"; echo "unknown: it did not answer within $secs seconds"; return; fi
  if [ "$rc" = 2 ] && grep -q "unrecognized subcommand" "$errf" 2>/dev/null; then rm -f "$errf"; echo old; return; fi
  rm -f "$errf"
  if [ "$rc" = 0 ]; then echo has; return; fi
  echo "unknown: running it exited $rc${err:+ ($err)}"
}

connector_verbs_check() {
  local bin="$1" gate_file="$2" gate probe
  gate="$(connector_gate_value "$gate_file")"
  if [ -z "$gate" ]; then
    echo "cannot read the phone-notifications ship gate in $gate_file (expected the line 'const PHONE_APP_CAN_RECEIVE = true;' or '= false;'); refusing rather than guessing" >&2
    return 1
  fi
  probe="$(connector_mac_request_probe "$bin")"
  case "$probe" in
    has) return 0 ;;
    old)
      if [ "$gate" = true ]; then
        echo "the Plus connector at $bin does not know 'mac-request', and PHONE_APP_CAN_RECEIVE is true, so this bundle would ship a phone-notifications switch that cannot turn on. Rebuild it with kosmos-relay tools/build-tunnel-release.sh (#103 or later), or set KOSMOS_TUNNEL_BIN to one that does." >&2
        return 1
      fi
      echo "note: this Plus connector predates mac-request; harmless until PHONE_APP_CAN_RECEIVE opens (docs/phone-push-go-live.md, step 6)." >&2
      return 0 ;;
    *)
      if [ "$gate" = true ]; then
        echo "could not check the Plus connector at $bin for 'mac-request' (${probe#unknown: }), and PHONE_APP_CAN_RECEIVE is true, so refusing. Check the file itself (its exec bit, a quarantine flag, a crash) or the reason above." >&2
        return 1
      fi
      echo "note: could not check this Plus connector for mac-request (${probe#unknown: }); harmless until PHONE_APP_CAN_RECEIVE opens." >&2
      return 0 ;;
  esac
}
