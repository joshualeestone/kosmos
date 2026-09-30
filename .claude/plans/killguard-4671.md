# killguard-4671: the report hook refuses a tool call that stops every process the person owns

Card: kosmos#4671. Incident: #4669 comment 5901814664 (Mortals, 2026-09-29 19:27).

## Call
A guard in install/kosmos-report-hook.sh, the hook Kosmos already wires (matcher '') into every Claude
agent's settings. On PreToolUse it reads, with jq, only what runs or is written (tool_input command,
script, code, args, content, new_string, new_source, edits[].new_string) for ANY tool; a Write/Edit to a
.md/.markdown/.txt file is skipped. Without jq it reads the raw input. On a literal shape that stops every
process the person owns it prints the reason and exits 2, which blocks that one call:
- a shell kill whose target is minus one (quoted, via xargs, or a here-string too);
- code signalling minus one (node, Python, C, Ruby, Perl, argv arrays);
- pkill/killall limited only by a user, or with a match-everything pattern; kill fed by `pgrep -u <user>`;
- launchctl bootout of a whole gui/user/login domain, launchctl reboot.
Each arm is tested on its own (review 2's B1: an early return in one arm hid the others).
The operator can turn it off per agent with KOSMOS_KILL_GUARD=off in the agent's launch environment.

This deliberately changes the hook's "every path exits 0" contract in one narrow place; the header says so.

## Rejected
- A list heuristic for the incident's own shape (minus one in a list, a variable passed to the call): on
  our repo it would refuse 3 of the 26 files that signal processes, all falsely.
- A runtime guard (NODE_OPTIONS preload wrapping process.kill): catches a computed pid, but if the preload
  path goes missing every node command every agent runs fails. Its own decision, on the card.

## Weakest premise
It is a text match: the 2026-09-29 script itself (a computed pid) passes, pinned as a KNOWN GAP in the
test. Windows agents (the node hook) and Codex/Gemini/Grok agents are not guarded.

## Tests
report-hook-killguard-4671.test.js drives the real hook, every Bash case with and without jq; the cases are
written with uppercase placeholders so the test file never holds a literal shape (an agent editing it is
not refused). 190/190; with the guard disabled 115 fail and 75 pass (the controls, plus the arms that assert no block). Hook suites 334/334.
Reviews: round 1 (1 blocker, 6 warnings), round 2 (3 blockers, 5 warnings), round 3 (1 blocker, 2 warnings, 7 nits; N7 killall -s dry-run left refused) all addressed.
