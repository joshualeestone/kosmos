# killguard-4671: the report hook refuses a tool call that signals every process the person owns

Card: kosmos#4671. Incident: #4669 comment 5901814664 (Mortals, 2026-09-29 19:27).

## Call
Add a guard to install/kosmos-report-hook.sh, the hook Kosmos already wires into every Claude agent's
settings for PreToolUse. On a Bash, Write, Edit, MultiEdit or NotebookEdit call whose raw input holds a
shell `kill` whose target is -1, `killall`, `pkill ... -u`, or code that signals pid -1 (process.kill(-1,
os.kill(-1, kill(-1, ...), it prints the reason on stderr and exits 2, which blocks that one call.
No new wiring, no migration: it reaches every existing Claude agent with the next update.

This changes the hook's "every path exits 0" contract on purpose, in one narrow place; the header says so.

## Rejected
- A list heuristic (a -1 inside a list plus a signal call), which is the shape of the actual incident.
  Measured on our own repo: 3 of the 26 files that call process.kill( or os.kill( would be refused, all
  three false (-1 as an assertion value or a loop constant). Blocking legitimate edits that often is worse.
- A runtime guard (NODE_OPTIONS preload that wraps process.kill), which would catch the computed pid.
  Its failure mode is severe: if the preload path ever goes missing, every node command an agent runs
  fails. That is its own decision, recorded on the card.
- `kill -1 <pid>` (SIGHUP to one process), process.kill(0) and negative group ids stay allowed: bounded.

## Weakest premise
It is a text match. It stops the literal shapes, not the incident's own computed pid, which the test pins
as a KNOWN GAP so it is never read as coverage. Windows agents use engine/kosmos-report-hook.js, which does
not carry the guard. Codex, Gemini and Grok agents have no such hook.

## Tests
report-hook-killguard-4671.test.js drives the real hook: 13 blocked Bash shapes, 8 allowed controls, a
blocked Write and Edit, an allowed Write and Read, another event not guarded, and the known gap.
With the guard disabled 14 fail and the 11 controls pass; with it, 25/25.
