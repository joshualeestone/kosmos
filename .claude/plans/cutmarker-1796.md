# Plan: cut-guard detects a live run by a harness-owned marker, not a live-tree walk (kosmos#1796)

## Problem
The three mutual guards in tools/lib/cut-guard.sh (kosmos_refuse_if_cut_live /
kosmos_refuse_if_harness_live / kosmos_refuse_if_browser_run_live) detect a live run by grepping the
process table for the script NAME and self-exclude by walking the LIVE process tree
(_kosmos_pid_is_self_or_descendant, ps -o ppid=). Two consequences (kosmos#1796):
1. The self-exclusion RACES under load -- a nested descendant whose intermediate ancestor exits
   mid-walk is reparented to pid 1, misses `root`, and reads as a separate run (the code's own named
   KNOWN RESIDUAL). Only the BROWSER guard genuinely self-matches (browser-checks.sh forks subshells
   inheriting `bash tools/browser-checks.sh`); the cut/harness callers do not, so their walk is
   largely defensive. Candidate mechanism, not reproduced deterministically.
2. RUNNING vs WORKING is decided by a regex filter: the person hardening test-install.sh (a worktree
   named after it, `bash -n`, `git add`) must not block a cut, and a real run must.

## The fix (marker, additive)
kosmos_mark_run <type> writes $DIR/<type>.<pid> whose body is a per-run cookie. The guards prefer a
MARKER check:
- self-exclusion is a COOKIE string-compare (no ps walk) -> the race is gone from the primary path;
- a dead-pid marker is ignored and unlinked (a crash cannot brick the guard);
- "working on the script" writes no marker -> never a candidate (the structural run-vs-work split).
Wired: release.sh -> mark cut; test-install.sh -> mark harness; browser-checks.sh -> mark browser,
each BEFORE its refuse checks so the cookie self-exclusion is set.

ADDITIVE: the name+filter arm is UNCHANGED and still runs; a guard refuses if EITHER arm finds a
separate live run. So a concurrent run from a build that predates markers (the transition, or any
unwired caller) is still caught. Once every caller marks, the name arm is a backstop.

🛑 MITIGATES, does not ELIMINATE, problem 1 (the race). The refusal is `{ name } || { marker }`,
so the name arm still walks the live tree and still carries the reparent race for the browser guard
(the one caller that self-matches). The marker path is race-free (cookie compare), but the OR means
a name-arm-only false-refuse under load is still possible. Fully closing the race means RETIRING the
name arm + its walk once every caller marks -- a deliberate FOLLOW-UP, not done here, so the
transition keeps its backstop. What this PR closes for certain: the structural run-vs-work split and
the self-exclusion race on the marker path. Do not read it as "the race is closed."

## Named residual (the one new class, safe-direction)
A marker's pid can be REUSED by an unrelated process between the marking run exiting and the next
reader cleaning the stale marker, so a reader can read a live-but-foreign pid and refuse. The window
is small (every guard call cleans dead-pid markers first) and the direction is the one this file
already chooses -- it over-refuses, never misses a separate run -- and the same KOSMOS_*_IGNORE_*
override clears it. Named, as the file names its other residuals.

## Test (tools/test-cut-guard.sh)
All existing probe + end-to-end arms UNCHANGED (marker dir isolated to an empty fixture via
KOSMOS_RUN_MARKER_DIR so the always-on marker arm reads no real marker). Added 7 marker arms, each
with a fresh dir + probe-quiet (name arm clean) so ONLY the marker arm can fire:
- a live foreign-cookie marker refuses and names the pid;
- the caller's OWN marker (matching cookie) is not a reason to refuse (the self-refuse outage);
- a stale (dead-pid) marker does not refuse and IS cleaned;
- no marker (working, not running) does not refuse;
- kosmos_mark_run harness makes a real run detectable end-to-end by a separate guard call.
0 failures (existing + marker arms). bash -n clean on all four touched scripts.

## Weakest premise
That the reparent-RACE (problem 1) is a real production defect. It is a candidate I could not
reproduce deterministically, and only the browser guard truly self-matches. What is CERTAIN is the
structural run-vs-work split and that the marker removes the walk from the primary path. The change
is worth it on the certain grounds alone, and it is additive so it cannot regress the name arm.

## Scope / rollout
agent-workforce (kosmos), 0 rulesets -> can land today. The name-arm fallback makes the change safe
regardless of which cut ships it (no detection gap during the transition cut). Self-merge per beta
norm after challenge-loop + a green PR CI.
