#!/bin/bash
# Sweep the gui domain for leaked sandbox supervisors (#626).
#
# 🔑 THE CLASS THIS HUNTS: a sandboxed run's launchd machinery outliving its
# harness on a shared machine. The bl2 supervisor lived 21 hours past its test
# (#579); a sandboxed create planted com.kosmos.agent.pat into the real domain
# on 2026-08-24 and was reaped by hand within minutes only because somebody
# was watching. Each was found by accident or by incident; this is the sweep
# that finds them on purpose.
#
# 🔑 ONE JUDGING, NOT TWO. The classification is tools/lib/launchd-witness.sh's
# `lw_judge` (#566), fed an empty "before" so every currently-registered
# com.kosmos.* job is judged: REAL under ~/Library/LaunchAgents, SANDBOX
# anywhere else, UNKNOWN when the job vanished between list and read. A second
# spelling of those rules here would drift from the witness the day either is
# edited. The sweep adds ONE further fact the witness has no reason to hold:
# whether a SANDBOX job's plist file still exists. A temp dir that has been
# cleaned is a job whose harness is gone -- LEAKED, the thing this tool is for.
#
# ⚠️ NAME BEFORE REAPING (#579's rule, held twice today). The sweep REPORTS by
# default. Reaping is a flag a person passes, and even then only LEAKED jobs
# are touched: a SANDBOX job whose plist still exists may be a test in flight
# this very minute, and a REAL job is the installed product. Neither is ours
# to stop.
#
# ⚠️ A REAPED JOB'S SESSIONS ARE NOT TOUCHED. Booting out a supervisor stops
# the process launchd holds; a tmux session that supervisor already made lives
# on its own server and survives (measured, the pat incident). The report says
# so rather than implying a clean sweep of things it never looked at.
#
# Exit codes, named because a caller branches on them:
#   0  swept, nothing leaked (REAL / live SANDBOX / UNKNOWN rows may exist and
#      are printed; none of them is a leak)
#   1  leaked jobs found (and, with --reap, the ones that would not reap)
#   2  could not look: launchctl itself did not answer, which must never be
#      dressed as "clean"
#
# Test seam: LAUNCHD_WITNESS_LAUNCHCTL, the lib's own, so the test drives
# every arm without touching the real gui domain.

set -u
cd "$(dirname "$0")/.." || exit 2
. tools/lib/launchd-witness.sh

REAP=0
[ "${1:-}" = "--reap" ] && REAP=1

# ⚠️ AN EMPTY SNAPSHOT MUST NOT READ AS A CLEAN MACHINE. lw_snapshot swallows
# launchctl's own failure into silence, and a sweep that cannot look reporting
# "nothing leaked" is the false-clean this tool's card forbids. So the sweep
# asks launchctl the cheapest real question first and refuses on failure.
if ! _lw_launchctl list >/dev/null 2>&1; then
  echo "could not look: launchctl did not answer, so nothing here is known -- not even that the machine is clean"
  exit 2
fi

REAL_DIR="${SWEEP_REAL_LAUNCH_DIR:-$HOME/Library/LaunchAgents}"
# The sweep runs from no sandbox of its own, so the OURS arm must be
# unreachable: /dev/null can have no children, so no plist path is under it.
NO_SANDBOX="/dev/null/sweep-has-no-sandbox"

LEAKED=0
FOUND=0
UNREAPED=0
while read -r verdict label path; do
  [ -n "$verdict" ] || continue
  FOUND=$((FOUND+1))
  case "$verdict" in
    REAL)
      echo "REAL     $label  $path  (the installed product; not this tool's business)" ;;
    UNKNOWN)
      echo "UNKNOWN  $label  (vanished between list and read; nothing left to act on)" ;;
    SANDBOX)
      if [ -e "$path" ]; then
        echo "SANDBOX  $label  $path  (its plist still exists, so its harness may be running; left alone)"
      else
        LEAKED=$((LEAKED+1))
        if [ "$REAP" -eq 1 ]; then
          if _lw_launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1; then
            echo "REAPED   $label  $path  (plist gone, harness gone; job booted out. Any session it already made is NOT touched)"
          else
            UNREAPED=$((UNREAPED+1))
            echo "LEAKED   $label  $path  (plist gone, and bootout FAILED; still registered -- reap it by hand)"
          fi
        else
          echo "LEAKED   $label  $path  (plist gone: its harness was cleaned and the job survived it. --reap boots it out)"
        fi
      fi ;;
  esac
done <<SWEEPEOF
$(lw_judge "" "$(lw_snapshot)" "$REAL_DIR" "$NO_SANDBOX")
SWEEPEOF

# A sweep that finds nothing says so; silence reads as a tool that did not run.
[ "$FOUND" -eq 0 ] && echo "no com.kosmos jobs registered at all: nothing to judge"
if [ "$LEAKED" -eq 0 ]; then
  echo "swept: nothing leaked"
  exit 0
fi
if [ "$REAP" -eq 1 ]; then
  if [ "$UNREAPED" -eq 0 ]; then
    echo "swept: $LEAKED leaked job(s) reaped"
    exit 0
  fi
  echo "swept: $UNREAPED of $LEAKED leaked job(s) would not reap"
  exit 1
fi
echo "swept: $LEAKED leaked job(s) found, none touched (pass --reap to boot them out)"
exit 1
