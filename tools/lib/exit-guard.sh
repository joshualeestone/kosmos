# exit-guard.sh: a script that dies must not exit 0 (kosmos#6831, after #6826).
#
# On this fleet's bash 3.2 (macOS /bin/bash and /bin/sh), a script with `set -e` AND an EXIT trap that dies on an
# unset variable (set -u), a failed `.`, `${VAR:?}` or a readonly assignment reaches the trap with $? already 0, so
# it exits 0 having stopped part way. Measured table on kosmos#6826. Without `set -e`, or without an EXIT trap, the
# status is kept.
#
# The guard: the script marks its success exits, and the EXIT trap turns any other 0 into exit 1 with one line.
#
#   . "$REPO/tools/lib/exit-guard.sh"
#   _cleanup() { rm -rf "$WORK"; }          # what the old EXIT trap did (or `:` for nothing)
#   kosmos_exit_guard _cleanup my-script    # replaces `trap '...' EXIT`
#   ...
#   kosmos_finished                         # directly before every success `exit 0`, and as the last line
#
# Not one of pkg_input_sha's hashed inputs (tools/lib/pkg-inputs.sh), on purpose: it decides whether a build is
# reported as finished, not what the pkg contains. An edit here does not rebuild the pkg.
#
# A non-zero exit keeps its own status. Source this BEFORE the guard is set: a failed `.` before any EXIT trap keeps
# its status anyway.

kosmos_exit_guard() {   # <cleanup function> <name for the message>
  _KX_FINISHED=0
  _KX_CLEANUP=${1:-:}
  _KX_NAME=${2:-script}
  trap '_kx_rc=$?; ( set +u; "$_KX_CLEANUP" ) || :; [ "$_kx_rc" != 0 ] || [ "${_KX_FINISHED:-0}" = 1 ] || { _kx_rc=1; echo "$_KX_NAME: the run stopped before finishing. Treat the run as FAILED (kosmos#6831)" >&2 || true; }; exit "$_kx_rc"' EXIT
}

kosmos_finished() { _KX_FINISHED=1; }
