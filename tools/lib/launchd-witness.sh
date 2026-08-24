# The com.kosmos launchd witness, extracted so a test can exercise it with a
# stubbed launchctl (#566). POSIX sh, sourced by tools/clean-machine.sh.
#
# 🔑 THE PROBLEM THIS SOLVES: launchd has ONE gui domain, so an honest
# create-and-chat verification anywhere on this Mac bootstraps a REAL
# com.kosmos.agent.* job into it, sandboxed store or not -- and the old
# witness (a strict before/after equality on labels) therefore failed on
# every such run, forever, and was being managed with hand-brokered timing
# windows. A sandboxed create and a real one must not look alike to the
# witness, which is the board's own #569 rule one layer down.
#
# ✅ THE DISTINGUISHING SIGNAL IS THE PLIST PATH, a checkable fact rather
# than a convention (verified on a live case, com.kosmos.agent.bl2, before
# this was written): AGENT_WORKFORCE_LAUNCH moves where the plist FILE is
# written, and `launchctl bootstrap` registers that path even though the
# only domain is gui/$UID. So:
#
#     under the REAL ~/Library/LaunchAgents  -> a real job. The witness's
#                                               whole reason to exist.
#     under THIS RUN's sandbox               -> our own leftover: the
#                                               uninstall leg failed to take
#                                               it down. The old witness's
#                                               teeth, kept on purpose --
#                                               ignoring these would let the
#                                               harness mask its own leak.
#     anywhere else                          -> somebody else's sandboxed
#                                               test create. Ignored, and
#                                               SAID, never silence: a
#                                               transient job must read as
#                                               "observed, ignored", not as
#                                               nothing.
#
# ⚠️ PATHS ARE SNAPSHOTTED AT THE SAME MOMENT AS THE LIST. The whole failure
# mode is jobs that appear and vanish inside the harness's minutes-long run;
# classifying a label minutes after listing it races the same way. The
# window between list and print is milliseconds; a job that vanishes inside
# even that answers "(gone)" and is named rather than guessed about.
#
# Test seam: LAUNCHD_WITNESS_LAUNCHCTL overrides the launchctl binary so
# tools/test-clean-witness.sh can drive every arm without touching the real
# domain. Same pattern as the engine's AGENT_WORKFORCE_TMUX_BIN.

_lw_launchctl() { "${LAUNCHD_WITNESS_LAUNCHCTL:-launchctl}" "$@"; }

# Every com.kosmos.* label in the gui domain, one "label<TAB>path" line each,
# path read immediately. A label whose job answers no path prints "(gone)".
lw_snapshot() {
  for _lw_l in $(_lw_launchctl list 2>/dev/null | grep -o 'com\.kosmos[^"[:space:]]*' | sort); do
    _lw_p="$(_lw_launchctl print "gui/$(id -u)/$_lw_l" 2>/dev/null | sed -n 's/.*path = //p' | head -1)"
    printf '%s\t%s\n' "$_lw_l" "${_lw_p:-(gone)}"
  done
}

# Judge the difference between two snapshots.
#   $1 before   $2 after   $3 the real LaunchAgents dir   $4 this run's sandbox root
# Prints one line per changed job:
#   REAL <label> <path>       a job under the real dir appeared or vanished
#   OURS <label> <path>       this sandbox's own job is still registered
#   SANDBOX <label> <path>    somebody else's sandboxed create; ignorable
#   UNKNOWN <label>           listed but gone before its path could be read
# Prints nothing when the snapshots agree. The CALLER decides what fails;
# this only names what happened, so the test and the harness cannot drift.
lw_judge() {
  _lw_real="$3"; _lw_sb="$4"
  printf '%s\n%s\n' "$1" "$2" | grep -v '^$' | sort | uniq -u | while IFS="$(printf '\t')" read -r _lw_label _lw_path; do
    [ -n "$_lw_label" ] || continue
    case "$_lw_path" in
      "(gone)")        printf 'UNKNOWN %s\n' "$_lw_label" ;;
      "$_lw_real"/*)   printf 'REAL %s %s\n' "$_lw_label" "$_lw_path" ;;
      "$_lw_sb"/*)     printf 'OURS %s %s\n' "$_lw_label" "$_lw_path" ;;
      *)               printf 'SANDBOX %s %s\n' "$_lw_label" "$_lw_path" ;;
    esac
  done | sort -u
}
