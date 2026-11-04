# sigpipe-7946: `kosmos agent remove` (Mac CLI) red on macOS CI, 141 and a lost control request (kosmos#7946)

## What the evidence says (measured)
- Three reds on three unrelated PRs (#7934, #7940, #7923), all in cli.agent-remove-7362.test.js's Mac half.
- #7940's red (`141 !== 1`, partial removal) printed a generated assertion message, so the CLI's own output (the
  message argument, `r.out`) was EMPTY: it exited 141 in 940 ms having said nothing, so before line ~7440, the first
  line that prints. Exit 141 as a CODE (not a signal) means bash itself exited with a pipeline's 141 under
  `set -euo pipefail` (line 28): a pipeline member took SIGPIPE.
- A bash -x trace of the real remove path (stub board) lists every executed source line (156). The only pipelines
  with a reader that can exit before its producer is done are the four `printf '%s\n' "$rm_plan" | head -n 1 | cut`
  reads (lines 7431-7432). The node readers, `tail -n +2` and `cut` all read to the end.

## What I could NOT show (the weakest premise)
That those four reads are what took SIGPIPE on CI. On this Mac, bash 3.2's printf writes the small plan in one
write (0/300 SIGPIPE against a one-byte reader; a two-write control 300/300), and 0/12000 runs under load 10-16 and
0/300 real CLI runs in parallel reproduced it. So the fix removes the only candidate the trace shows, but the CI cause
may be elsewhere (something before the plan read, or a runner-specific difference).

## Built
- install/kosmos `agent remove`: the plan's first line by parameter expansion (`${rm_plan%%$'\n'*}`) and each field
  by `cut -fN <<<"$rm_head"`: no pipe, so no early reader. Same output: cut sees the same newline-terminated line.
  The file's own rule for this hazard (line ~623, a case statement, not `printf | grep -q`).
- cli.agent-remove-7362.test.js:
  - the `.`/`..` Mac controls now assert the control call's exit code (0) and carry its output in both messages, so
    the next red names where the CLI stopped instead of `0 !== 1`;
  - #7946: a structural test that the remove block has no pipeline into head, grep -q, an exiting awk or a quitting
    sed; its control proves the pattern catches the removed shape and each early reader, and passes a full reader.

## Decided
- Not a SIGPIPE trap: trapping PIPE would hide a real early exit elsewhere; removing the pipe is the file's convention.
- The card stays open after merge until macOS CI has run this file clean for a while, or the new diagnostics name a
  different stop; then close or re-scope. What would change my mind: a red after this merge whose output names a line.

## Tests
`node --test cli.agent-remove-7362.test.js`: 23/23. Mutant: main's install/kosmos with the new test fails exactly
the #7946 check (22/23). Full validation: see the proof.
