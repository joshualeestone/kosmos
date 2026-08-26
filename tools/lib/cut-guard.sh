# The live-cut guard (#708). Two copies of the install gate on one Mac share
# the fixed port range, the real ~/Applications and /Applications
# fingerprints and the gui launchd domain, and they poison each other:
# measured 2026-08-26 01:29, a local run went red on "real home Applications
# unchanged" at the second cut 0.5.54's own gate was installing. A cut has
# no lock file; it has a process (tools/release.sh) for as long as it runs,
# so that is what this asks. The probe is a seam (KOSMOS_CUT_PROBE) so the
# guard can be shown red and green without a cut. A probe that cannot
# answer is a refusal, not a pass, the same posture as the disk guard.
kosmos_refuse_if_cut_live() {
  local what="${1:-this run}" probe="${KOSMOS_CUT_PROBE:-}" raw out rc
  if [ -n "$probe" ]; then
    out="$("$probe" 2>/dev/null)"; rc=$?
  else
    # ⚠️ THE PROCESS, NOT THE WORDS: a peer's shell whose command text merely
    # mentions release.sh (a git log, a grep, an eval) matched the first
    # draft and would have refused every run on a busy Mac. Only a bash/sh
    # whose own command line starts with the script counts. pgrep's status
    # is read from its own line, never after a pipe (#632).
    raw="$(pgrep -fl 'release\.sh' 2>/dev/null)"; rc=$?
    out="$(printf '%s\n' "$raw" | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/release\.sh( |$)' || true)"
    # pgrep: 0 matched, 1 nothing matched, 2+ could not run. After the
    # filter, an empty list is a clean "no cut" whichever of 0/1 pgrep said.
    if [ "$rc" -le 1 ]; then rc=0; [ -n "$out" ] || rc=1; fi
  fi
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether a cut is running (the probe exited $rc); refusing to guess for $what. KOSMOS_HARNESS_IGNORE_CUT=1 runs anyway." >&2
    return 1
  fi
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    echo "a cut is running on this Mac ($(printf '%s\n' "$out" | head -1 | cut -c1-80)); $what would share its ports, its real-folder fingerprints and its launchd domain, and either result could be the other's. Wait for the cut's 'completed' line in ~/.claude/logs/cut-suite-runs.log, or KOSMOS_HARNESS_IGNORE_CUT=1 to run anyway." >&2
    return 1
  fi
  return 0
}
