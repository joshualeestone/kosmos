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
  line="$(grep -E '^const PHONE_APP_CAN_RECEIVE = (true|false);[[:space:]]*$' "$1" 2>/dev/null | head -1)"
  case "$line" in
    *'= true;'*) echo true ;;
    *'= false;'*) echo false ;;
    *) : ;;
  esac
}

connector_verbs_check() {
  local bin="$1" gate_file="$2" gate
  gate="$(connector_gate_value "$gate_file")"
  if [ -z "$gate" ]; then
    echo "cannot read the phone-notifications ship gate in $gate_file (expected the line 'const PHONE_APP_CAN_RECEIVE = true;' or '= false;'); refusing rather than guessing" >&2
    return 1
  fi
  if "$bin" mac-request --help >/dev/null 2>&1; then
    return 0
  fi
  if [ "$gate" = true ]; then
    echo "the Plus connector at $bin does not know 'mac-request', and PHONE_APP_CAN_RECEIVE is true, so this bundle would ship a phone-notifications switch that cannot turn on. Rebuild it with kosmos-relay tools/build-tunnel-release.sh (#103 or later), or set KOSMOS_TUNNEL_BIN to one that does." >&2
    return 1
  fi
  echo "note: this Plus connector predates mac-request; harmless until PHONE_APP_CAN_RECEIVE opens (docs/phone-push-go-live.md, step 6)." >&2
  return 0
}
