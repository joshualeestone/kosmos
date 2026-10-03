# #5092: the #3011 leak guard skips the LIVE install rewriting its own agents' plists

## Problem (measured, Mortals 2026-10-02 22:11)
Josh switched Liu Kang mid-suite; the live board rewrote `com.kosmos.agent.liukang.plist` (born Sep 11) and an
unrelated branch's full run went red on the #3011 guard. Related: #4392 (Baron) skips live-CHECK agents by a
reserved name prefix; that cannot cover the live install's real agents, which have real names.

## The call
`launchagent_leak_check` drops a changed plist only when BOTH hold:
1. it was already in the pre-suite snapshot (MODIFIED; a NEW plist always reds, wherever it points), and
2. its WorkingDirectory is exactly `<live_root>/<name>` (one segment; not the root, not nested, not `..`, not a
   look-alike prefix). `<live_root>` defaults to `$HOME/work/workers` (store.workersRootFor's default).
Each skip goes to an optional notes file; run-tests.sh prints a `#5092 note` line per skip, so it is never silent.

## Rejected
- Skipping by name: the live agents have arbitrary real names (unlike #4392's reserved prefix).
- Skipping any modified plist: a test re-writing a real plist with a sandbox WorkingDirectory must still red.
- Reading the live install's own agent list: more coupling for the same answer the path already gives.

## Weakest premise
A test that rewrites a REAL pre-existing plist AND keeps its real WorkingDirectory would pass. #3605's
launch-guard.js refuses any test's write into the real LaunchAgents under node --test, so it fails first.
Also: a live install with AGENT_WORKFORCE_WORKERS set elsewhere is not covered (the default root only).

## Tests
`tools/test-launchagent-leak-guard-3011.sh`: + 15 legs (skip + note; NEW-under-live control; six modified
shapes that must red: sandbox, nested, root, look-alike, `..`, trailing slash; an XML-escaped root reds; default
root from $HOME; "/" turns the skip off; runner passes notes + live root; runner's no-notes fallback is "/").
Sabotages: S1 (drop "was in snapshot") -> the NEW control reds; S2 (everything live-owned) -> all six shapes
and the original modify control red; S3 (no skip) -> the skip, note and default-root legs red.
Replayed on the REAL Mortals liukang plist (copied read-only): live-owned under /Users/mortalkombat/work/workers,
not under another root. 10 shell tests touching run-tests.sh pass (test-install.sh needs dist/, same on main);
23 node files touching run-tests.sh: 541/0.

## Review log
- Review 1 (opus, blind): 0 B, 1 W, 5 N. W named worlds (<world>/workers) and connected-folder agents also write
  plists to the shared LaunchAgents; restarting one mid-suite still reds -> ACCEPTED, documented in the lib comment
  (a false red, the safe direction; widening means reading the worlds registry and recorded dirs from the shell).
  N1/N2 comments made honest (the AGENT_WORKFORCE_WORKERS sandbox is a convention; #3605's real reach and its
  residual hole named). N3 no notes file -> live root "/" turns the skip off (a skip is never silent); leg uses a
  one-segment WorkingDirectory "/offagent", the only shape the off switch alone catches. N4 note wording:
  "assumed to be the live install". N5 legs: a trailing-slash WorkingDirectory and an XML-escaped root both red.
- Sabotages on the final code: S1 drop "was in snapshot" -> the NEW control reds; S2 everything live-owned -> all
  shape controls red; S3 no skip -> skip, note and default-root legs red; S4 drop the empty-root check -> the "/"
  leg reds (it did NOT before the leg used a one-segment path; fixed).
- Review 2 (sonnet, blind): 0 B, 2 W, 3 N. W1 the runner's no-notes fallback was untested -> a leg pins it (and
  the live-root argument). W2 the note now names the other possible writer (a concurrent older checkout's suite).
  N1 plan numbers; N2 the live-root argument is quoted (empty means the default either way) and the comment says
  so; N3 the one-line WorkingDirectory read is stated (a multi-line plist reds, the safe direction).
- Sabotage S5 (the runner's no-notes fallback removed) -> the fallback leg reds. S1 to S4 unchanged (lib untouched
  in review 2 except comments).
- Review 3 (opus, blind): 0 B, 1 W, 2 N. W the runner's print loop was untested -> moved into the lib as
  launchagent_live_notes_report, called by run-tests.sh; behavioural legs (it names the plist and its folder;
  empty/missing file prints nothing) plus a pin that the runner calls it. N baseline lookup by awk instead of
  cut | grep -q (pipefail SIGPIPE false red on a huge baseline). N plan count.
- ALL SABOTAGES RE-RUN on the review-3 code (each against restored files; THIS is the current record):
  S1 drop "was in snapshot" -> NEW control; S2 everything live-owned -> 9 legs (original modify control, six
  shapes, XML-escaped root, "/"); S3 no skip -> skip, note, default root; S4 drop the empty-root check -> "/";
  S5 runner fallback removed -> fallback pin; S6 report prints nothing -> report leg; S7 runner never calls the
  report -> the call pin.
