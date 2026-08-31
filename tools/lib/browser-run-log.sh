#!/bin/sh
# A durable, append-only record of every page-layer run (#1079).
#
# 🛑 WHY THIS EXISTS. `tools/browser-checks.sh` tracks retries in an in-memory
# array, prints them once at the summary, and discards its RUN_DIR (a mktemp).
# So every retry observation depends on a person reading scrollback and filing a
# card. #1079 has exactly one data point, from 07:04 on one day, and nothing
# since - not because the flake has not recurred, but because nothing would have
# recorded it if it had.
#
# ⭐ IT LOGS EVERY RUN, NOT EVERY RETRY, AND THAT IS THE WHOLE DESIGN. #1079's
# hypothesis is that a fifth concurrent server (the rich board) causes contention
# that makes the heaviest check retry. That is a RATE question, so it needs
# runs-with-rich-board and runs-without, each with their retry counts. A log of
# retries alone is a numerator with no denominator, and reasoning about how
# failures are distributed WITHOUT dividing by how many runs there were is
# exactly the base-rate error this fleet published and had to retract this week.
#
# 🛑 IT MUST NEVER FAIL A RUN. A release gate that goes red because a log
# directory was not writable would be a worse defect than the one this is here to
# measure. Every path returns 0; the only symptom of a broken log is a line on
# stderr.

## browser_run_log_path
## The log to append to. Overridable so a test can point it somewhere scratch.
browser_run_log_path() {
  printf '%s' "${KOSMOS_BROWSER_RUN_LOG:-$HOME/.local/log/kosmos-browser-runs.log}"
}

## browser_run_log_append <sha> <ran> <retried_count> <failed_count> <rich_boards> [retried names...]
##
## One key=value line per run. key=value rather than prose because the question
## this answers is arithmetic ("retry rate with rich boards versus without"), and
## prose has to be re-parsed by whoever asks next.
browser_run_log_append() {
  _sha="${1:-unknown}"; _ran="${2:-0}"; _ret="${3:-0}"; _fail="${4:-0}"; _rich="${5:-0}"
  shift 5 2>/dev/null || true
  _names="$*"
  [ -n "$_names" ] || _names="none"

  _log="$(browser_run_log_path)"
  _dir="$(dirname "$_log")"
  if ! mkdir -p "$_dir" 2>/dev/null; then
    echo "browser-run-log: could not create $_dir; this run is not recorded (the run itself is unaffected)" >&2
    return 0
  fi
  # ⚠️ ONE printf, not several appends. Two processes can finish a run at once on
  # this machine, and a single write of a single short line is the cheapest thing
  # that does not interleave halfway.
  if ! printf '%s sha=%s ran=%s retried=%s failed=%s rich=%s names=%s\n' \
      "$(date -u +%FT%TZ)" "$_sha" "$_ran" "$_ret" "$_fail" "$_rich" "$_names" >> "$_log" 2>/dev/null; then
    echo "browser-run-log: could not append to $_log; this run is not recorded (the run itself is unaffected)" >&2
    return 0
  fi
  return 0
}
