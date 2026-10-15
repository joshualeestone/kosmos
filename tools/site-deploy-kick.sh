#!/bin/bash
# kosmos#6266: the reliable 15-minute backstop for chaoskosmos-site's "site deploy" workflow.
#
# Why: the workflow deploys on every push to site main and, as a backstop, on a 15-minute GitHub schedule. On
# 2026-10-15 the push run skipped because the 0.7.51 cut was running ("main waits for the next tick"), the cut then
# failed and published nothing, and GitHub fired the 15-minute schedule only six times that day (00:32, 05:15, 10:12,
# 15:05, 19:08, 22:19 UTC), so the change waited until a person dispatched the workflow by hand. GitHub documents
# scheduled workflows as best effort, delayed or dropped under load, so the backstop cannot rest on it.
#
# What: run every 15 minutes by launchd on Mortals (tools/install-site-deploy-kick.sh), this asks the workflow to run
# (workflow_dispatch, ref main) only when site main differs from what the deploy job last published, using the job's
# own state folder. Everything else stays the job's: the cut check, the lock, retries and parking, the reports. So:
#   - paused (a person made ~/.kosmos-site-autodeploy/paused): nothing is asked;
#   - main equals last-deployed, or main is the parked sha: nothing is asked (the job reports a parked sha itself);
#   - a site deploy run on main is queued or running: nothing is asked. A queued one deploys main as it is when it
#     starts; a merge made while one is already running waits for the next tick;
#   - a site deploy run on main was created, or (one that FAILED) ended, less than KICK_GAP_S (14 minutes) ago:
#     nothing is asked (review 6: only a failure's end counts, so a slow green run, a skip behind a cut or a retry exit
#     does not push the next ask to 30 minutes). So it never asks beside a recent run's creation or a recent failure
#     (the job retries a failure once on the next tick and then parks it; asking sooner would spend that retry within
#     minutes, reviews 1 and 3). A green "try again later" exit (the live site moving, a mirror or checksum retry)
#     from a run that took over 13 minutes can be followed by an ask within minutes, which brings that retry count's
#     alarm sooner; such runs are rare (review 9). GitHub's push and schedule triggers still fire on their own, as before, so a schedule run can
#     land just after an ask: two runs minutes apart, which brings the job's retry alarm (4 ticks) sooner. Rare, as
#     the schedule itself is (six times on 2026-10-15);
#   - otherwise one dispatch. A tick the job skips (a cut still running) is asked again 15 minutes later.
# A STUCK run is not counted as active (review 2: one would otherwise silence this backstop for good): one not finished
# 3 hours after it was created. One limit from creation, because GitHub stamps a run's startedAt at creation too
# (measured on chaoskosmos-site 2026-10-15: equal on every run), so queue time and running time cannot be told apart;
# 3 hours is the job's 45-minute timeout plus a long wait behind CI on the shared runner (reviews 3 and 4). It gets a
# line, the tick still asks (a new dispatch replaces a stuck pending run; behind a stuck queued one it waits its turn),
# and the tick exits 1 so launchctl's last exit code shows it. A run that really waited near 3 hours behind CI and is
# now inside its own 45 minutes is called stuck too (one misleading line and one extra pending dispatch): the cost of
# not being able to see when a run started. While a release cut runs, each tick's run is skipped by the job in
# seconds: one short run per 15 minutes on the shared runner, the pace the schedule was meant to have.
# Each tick writes the time to its heartbeat file (it proves launchd STARTED the tick, not that gh worked; the log
# says what the tick did), so a quiet log can be told apart from a job that never runs. A tick prints only when it
# asks, cannot read something, or sees a stuck run (at most two lines); the log is not rotated (about 10 to 20 KB a
# day at worst; kept by --uninstall).
#
# Not covered (the job's schedule run still covers it): live gone back to an older commit while main is unchanged;
# this compares main with last-deployed only. Accepted: a lost gh login or workflow scope fails every tick, seen only
# in kick.log, last-result and launchctl's last exit code; GitHub's push and schedule runs keep working regardless.
# Fails closed (review 5): with no state folder (the job has never run here, or this looks in the wrong place), the
# pause, the parked sha and last-deployed cannot be read, so it asks nothing, says so, and exits 1.
# --check prints what a tick would do (main, last deployed, runs, the decision) and dispatches nothing, and the kosmos
# commit the installer copied it from.
# Env (tests point these at fakes): KOSMOS_SITE_REPO, KOSMOS_AUTODEPLOY_STATE, KOSMOS_GH, KOSMOS_KICK_HEARTBEAT,
# KOSMOS_KICK_NOW (epoch seconds, for tests).
set -u
REPO="${KOSMOS_SITE_REPO:-joshualeestone/chaoskosmos-site}"
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
GH="${KOSMOS_GH:-/opt/homebrew/bin/gh}"
[ -x "$GH" ] || GH="$(command -v gh 2>/dev/null || echo "$GH")"   # review 7: another install path (the plist PATH has it)
# Review 11: every gh call has a wall clock (perl's alarm, as the deploy job's own network calls do), so one call hung
# on a stalled connection cannot hold the backstop for ever (launchd never starts a second copy while one runs). A
# timed-out call fails like any other, with "(timed out)" in its line.
GH_MAX_S="${KOSMOS_KICK_GH_TIMEOUT:-90}"
# Review 12: gh is a Go program and Go ignores SIGALRM, so exec under an alarm never stopped it (measured: a call to an
# unroutable host ran its own 30 s dial timeout past a 3 s alarm). So perl forks gh into its own process group, waits,
# and on the deadline sends that group TERM, then KILL, and exits 142.
ghb() {
  perl -e '
    my $t = shift;
    my $pid = fork; defined $pid or exit 126;
    if (!$pid) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127 }
    $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 2; kill "KILL", -$pid; waitpid($pid, 0); exit 142 };
    alarm $t;
    waitpid($pid, 0);
    exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
  ' "$GH_MAX_S" "$GH" "$@"
}
BEAT="${KOSMOS_KICK_HEARTBEAT:-$HOME/.local/libexec/kosmos-site-deploy-kick/last-tick}"
KICK_GAP_S=840
STUCK_S=10800   # not finished 3 hours after creation
CHECK=0
case "${1:-}" in
  '') ;;
  --check) CHECK=1 ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;   # review 11: a mistyped --check must not run a real tick
esac
LAST_LINE=""
say() { LAST_LINE="$*"; printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }
note() { [ "$CHECK" = 1 ] && say "check: $*"; return 0; }
# BSD date on macOS (Mortals); GNU date's -d only on Linux, where the tests also run (review 10: on macOS -d means
# something else, so it is never tried there).
if [ "$(uname -s)" = Darwin ]; then epoch() { date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null; }
else epoch() { date -u -d "$1" +%s 2>/dev/null; }; fi
# Review 6: every tick leaves its result (exit code and its last line) in last-result, beside the heartbeat, so a
# failing backstop is one file to look at, and --check shows it. Heartbeat and trap come first (review 9), so even a
# tick that cannot make its temporary file leaves both.
RESULT="$(dirname "$BEAT")/last-result"
ERR=""
trap 'rc_=$?; [ -n "$ERR" ] && rm -f "$ERR"; [ "$CHECK" = 1 ] || printf "%s rc=%s %s\n" "$(date "+%Y-%m-%d %H:%M:%S %Z")" "$rc_" "${LAST_LINE:-(quiet)}" > "$RESULT" 2>/dev/null' EXIT
[ "$CHECK" = 1 ] || { mkdir -p "$(dirname "$BEAT")" 2>/dev/null; date '+%Y-%m-%d %H:%M:%S %Z' > "$BEAT" 2>/dev/null; }
ERR="$(mktemp "${TMPDIR:-/tmp}/kick-err.XXXXXX" 2>/dev/null)" || { ERR=""; say "could not make a temporary file; nothing asked"; exit 1; }
why() { local rc=$?; local l; l="$(head -n 1 "$ERR" 2>/dev/null | cut -c1-160)"
  [ "$rc" = 142 ] && l="${l:+$l; }timed out after ${GH_MAX_S} s"
  [ "$rc" = 127 ] && l="${l:+$l; }no gh found at $GH or on PATH"
  [ -n "$l" ] && printf ' (gh: %s)' "$l"; }
NOW="${KOSMOS_KICK_NOW:-$(date +%s)}"

if [ "$CHECK" = 1 ] && [ -r "$(dirname "$BEAT")/source" ]; then note "installed from kosmos $(head -n 1 "$(dirname "$BEAT")/source")"; fi
if [ "$CHECK" = 1 ] && [ -r "$RESULT" ]; then note "last tick: $(head -n 1 "$RESULT")"; fi
if [ ! -d "$STATE" ]; then say "no deploy state folder at $STATE (the deploy job has not run here, or it keeps its state elsewhere); nothing asked"; exit 1; fi
if [ -e "$STATE/paused" ]; then note "paused ($STATE/paused): would ask nothing"; exit 0; fi
main="$(ghb api "repos/$REPO/commits/main" --jq .sha 2>"$ERR")" || { say "could not read site main ($REPO)$(why); nothing asked"; exit 1; }
case "$main" in
  *[!0-9a-f]*|'') say "site main read as '${main:0:60}', not a sha; nothing asked"; exit 1 ;;
esac
[ "${#main}" -eq 40 ] || { say "site main read as '${main:0:60}', not a full sha; nothing asked"; exit 1; }
deployed="$(tr -d '[:space:]' 2>/dev/null < "$STATE/last-deployed" || true)"
note "site main ${main:0:9}, last deployed ${deployed:0:9}"
[ "$main" = "$deployed" ] && { note "main is deployed: would ask nothing"; exit 0; }
parked="$(tr -d '[:space:]' 2>/dev/null < "$STATE/parked" || true)"
[ "$main" = "$parked" ] && { note "main is parked: would ask nothing"; exit 0; }
# One TAB-separated line per run: status, conclusion, createdAt, updatedAt. gh gives an unfinished run's conclusion as
# "" (not null; measured 2026-10-15), so it is mapped to "-": an empty field would let `read` shift the rest (review 7).
# The newest 20 runs hold the newest active one (the job runs one at a time and a superseded pending run is
# cancelled); after many pushes during one long run, that run may fall out of the window and go unreported if stuck.
runs="$(ghb run list --repo "$REPO" --workflow site-deploy.yml --branch main --limit 20 --json status,conclusion,createdAt,updatedAt --jq '.[] | [.status, (if (.conclusion // "") == "" then "-" else .conclusion end), .createdAt, .updatedAt] | @tsv' 2>"$ERR")" \
  || { say "could not list site deploy runs$(why); nothing asked"; exit 1; }
active=0; newest=""; stuck=""
# Its own line goes to stderr: stamp runs inside $( ), whose stdout is the value (launchd logs both).
stamp() { local v; v="$(epoch "$1")"; case "$v" in ''|*[!0-9]*) say "site deploy run time read as '${1:0:40}'; nothing asked" >&2; exit 1 ;; esac; printf '%s' "$v"; }
while IFS=$'\t' read -r status concl created updated; do
  [ -n "${status:-}" ] || continue
  # The parent sets LAST_LINE itself: stamp's own say runs in the $( ) subshell (review 7).
  c="$(stamp "$created")" || { LAST_LINE="site deploy run time read as '${created:0:40}'; nothing asked"; exit 1; }
  u="$(stamp "$updated")" || { LAST_LINE="site deploy run time read as '${updated:0:40}'; nothing asked"; exit 1; }
  this_stuck=""
  if [ "$status" != completed ]; then
    [ $((NOW - c)) -gt "$STUCK_S" ] && this_stuck="$status since $created ($(( (NOW - c) / 60 )) minutes)"
    if [ -n "$this_stuck" ]; then stuck="$this_stuck"; else active=$((active + 1)); fi
  fi
  # When it was made; for a run that FAILED, when it ended (reviews 3 and 6: the job's one retry keeps its 15-minute
  # pace; a green run's length does not delay the next ask). Newest by time. A stuck run does not count.
  if [ -z "$this_stuck" ]; then   # for clarity only: a stuck run is older than the gap anyway
    last=$c
    case "$concl" in failure|timed_out|startup_failure) [ "$u" -gt "$last" ] && last=$u ;; esac
    { [ -z "$newest" ] || [ "$last" -gt "$newest" ]; } && newest="$last"
  fi
done <<< "$runs"
rc=0
STUCK_LINE=""
if [ -n "$stuck" ]; then STUCK_LINE="a site deploy run has been $stuck, past its limit; not waiting on it"; say "$STUCK_LINE"; rc=1; fi
[ "$active" -gt 0 ] && { note "$active run(s) queued or running: would ask nothing"; exit "$rc"; }
if [ -n "$newest" ] && [ $((NOW - newest)) -lt "$KICK_GAP_S" ]; then note "a run was created, or failed, $((NOW - newest)) s ago: would ask nothing"; exit "$rc"; fi
if [ "$CHECK" = 1 ]; then note "would ask for a site deploy"; exit "$rc"; fi
if ghb workflow run site-deploy.yml --repo "$REPO" --ref main >/dev/null 2>"$ERR"; then
  say "asked for a site deploy: main ${main:0:9}, last deployed ${deployed:0:9}"
  [ -n "$STUCK_LINE" ] && LAST_LINE="$LAST_LINE; and $STUCK_LINE"   # last-result keeps why rc is 1 (review 7)
else
  say "could not dispatch the site deploy for main ${main:0:9}$(why)"; exit 1
fi
exit "$rc"
