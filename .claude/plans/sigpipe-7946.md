# sigpipe-7946: `kosmos agent remove` (Mac CLI) red on macOS CI, 141 and a lost control request (kosmos#7946)

## What the evidence says (measured)
- Four reds on three unrelated PRs (#7934, #7940, #7923 twice), all in cli.agent-remove-7362.test.js's Mac half.
- #7940's red (`141 !== 1`, partial removal) printed a generated assertion message, so the CLI's own output (the
  message argument, `r.out`) was EMPTY: it exited 141 in 940 ms having said nothing, so before line ~7440, the first
  line that prints. Exit 141 as a CODE (not a signal) means bash itself exited with a pipeline's 141 under
  `set -euo pipefail` (line 28): a pipeline member took SIGPIPE.
- A bash -x trace of the real remove path (stub board) lists the main shell's executed lines (156). It does NOT see
  kosmos_curl, _kosmos_curl_once, kosmos_board_proven or kosmos_loopback_route (their trace goes to /dev/null with
  `2>/dev/null`); review round 1 read those by hand: their pipelines read to the end or are guarded, and every call sits
  under `|| rc=$?`, so a 141 there becomes rc=141 and say_unreached prints a line (never a silent exit). So the only
  unguarded early-reader pipelines before the DELETE are the four `printf '%s\n' "$rm_plan" | head -n 1 | cut` reads
  (lines 7431-7432). The node readers, `tail -n +2` and `cut` all read to the end.

## What I could NOT show (the weakest premise)
That those four reads are what took SIGPIPE on CI. Not reproduced here: 0/12000 runs of the reads under load 10-16
and 0/300 real CLI runs 12 at once. My "printf writes once" measurement does not settle it: review round 1 showed a
four-printf producer into `head -n 1` also took SIGPIPE 0/1500, so that instrument cannot see a multi-write producer
at this race's rate (my 300/300 control used a sleep between writes, which forces it). The reads stay the only
unguarded candidate; their guilt is unmeasured either way. So the fix removes the only candidate the trace shows, but the CI cause
may be elsewhere (something before the plan read, or a runner-specific difference).

## Built
- install/kosmos `agent remove`: the plan's first line by parameter expansion (`${rm_plan%%$'\n'*}`) and each field
  by `cut -fN <<<"$rm_head"`: no pipe, so no early reader. Same output: cut sees the same newline-terminated line.
  The file's own rule for this hazard (line ~623, a case statement, not `printf | grep -q`).
- cli.agent-remove-7362.test.js:
  - the `.`/`..` Mac controls now assert the control call's exit code (0) and carry its output in both messages, so
    the next red names where the CLI stopped instead of `0 !== 1`;
  - the partial-removal test and the two "removal reached/was sent" controls carry the CLI's exit code and output;
  - #7946: a structural test (`earlyReaders`) that the remove CASE's request code (not the argument parsing, the
    health check or kosmos_curl, read by hand above) has no pipeline into head, read, grep -q/-m/--quiet/--max-count,
    a quitting sed or an awk that exits outside END. Continued lines are joined, `||` is not a pipe, and env,
    assignments, `command`, a path, quotes and `{`/`(` are read past; quoted text is blanked to find pipes and comments
    (review 2). Controls: 23 early shapes caught (reviews 1 and 2's
    misses among them) and 12 full readers passed (their false positives among them).

## Decided
- Not a SIGPIPE trap: trapping PIPE would hide a real early exit elsewhere; removing the pipe is the file's convention.
- The card stays open after merge until macOS CI has run this file clean for a while, or the new diagnostics name a
  different stop; then close or re-scope. What would change my mind: a red after this merge whose output names a line.

## Tests
`node --test cli.agent-remove-7362.test.js`: 23/23. Mutant: main's install/kosmos with the new test fails exactly
the #7946 check (22/23). Here-strings vs pure expansion (review 1 NIT): kept cut, since cut prints a tab-free line
whole for every field and expansion would need to copy that rule; review 1 measured the new reads equal to the old
across empty, no-newline, no-tab, empty-field, trailing-tab, CR and glob inputs, and a missing TMPDIR. Full validation: see the proof.
