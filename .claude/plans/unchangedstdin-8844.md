# unchangedstdin-8844: `kosmos feedback write --unchanged` keeps a line piped in on stdin (kosmos#8844)

Finished means: an agent that follows the daily nudge ("run `kosmos feedback write --unchanged` ... add a line after it
if there is one new thing") and pipes that line in gets it saved and sent with the pointer, on the Mac and on Windows,
or a plain refusal before anything is saved. A plain `--unchanged` with nothing piped still saves the pointer alone.

## Measured first, on installed 0.8.12 (build c20e54b8f6), throwaway data folder, dead loopback collector

| arm | input | saved |
|---|---|---|
| A (the card) | `printf 'one new thing on stdin\n' \| kosmos feedback write --unchanged` | `Nothing new since my report of 2020-01-02.` (note gone, exit 0) |
| B (control) | `--unchanged </dev/null` | the same pointer alone |
| C (control) | `--unchanged one new thing as words` | `..., except: one new thing as words` |

Cause: both CLIs took the note only from words; stdin was never read on `--unchanged` (the #7886 Windows tests even
pinned a reader that throws).

## The call

- With NO words, `--unchanged` reads its one line from stdin. A terminal is not read. Reading ends when the input ends or
  after 3 s of quiet (Windows: the existing `readStandardInput` with `STDIN_QUIET_LIMIT_MS`; Mac: the same logic inside
  the node snippet `--unchanged` already runs). A line that stops without ending is refused, nothing saved (exit 2).
- With words, the words are the line and stdin is not read, exactly as a plain `feedback write` treats words + stdin.
- More than one line piped in is refused, nothing saved (Mac exit 8 inside node, then exit 2; Windows exit 2). The help
  and the nudge both say one line, and this stops a whole report, or unrelated data on an inherited stdin, from being
  saved and sent as the note (review round 1).
- A stdin read error with data is its own refusal (Mac exit 7), not the "stopped arriving" sentence.
- Windows PowerShell pipeline (text does not reach kosmos): refused with its own sentence pointing at the words form. The
  shared psPipelineRefused says "save the text in a file", which --unchanged refuses (review round 1).

Known residual: a script that runs a plain `--unchanged` inside `while read ...; do ...; done < list` now consumes the
loop's input (as `cat`, or a plain `feedback write`, would). A one-line list item is then saved as the note; more lines
are refused. Accepted: the nudge tells agents to type the command, not to loop it.
- Help line on both CLIs: "any text, as words or piped in, is added to it".

Rejected:
- Refusing stdin on `--unchanged` with a reason: the nudge invites the input, so keeping it is what the agent meant.
- A bare `cat` on the Mac (the plain write's way): a plain `--unchanged` returns at once today, and under a harness whose
  stdin is an open pipe nobody writes to, `cat` would hang it. The quiet limit keeps it instant-ish (3 s worst case).
- Refusing words + stdin together: cannot be detected without reading stdin, and the plain write path ignores stdin when
  words are given; kept the same.

Weakest premise: that 3 s of quiet is long enough for an agent's `printf ... |` to deliver its line. It is the limit the
Windows plain write has used for a long time; a slow writer is refused (not saved in part), so the failure is loud.

What would change my mind: an agent harness that pipes the note in more slowly than 3 s in normal use.

## Tests

- `cli.feedback-unchanged-stdin-8844.test.js`: Mac real CLI + engine: stdin note saved; CONTROL nothing piped = pointer
  alone; words win over stdin; open pipe does not hang; a cut line refused, nothing saved; no earlier report still
  refuses. Windows stub: piped note added, control, cut refused, words do not read stdin.
- `cli.feedback-unchanged-7886.test.js`: its no-words Windows cases now get an empty piped input; cases with words still
  throw if stdin is read.
