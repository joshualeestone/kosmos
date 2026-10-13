# bcsmfast-5907: the browser-check surface-map test counts every token in one pass (#5907)

Card: joshualeestone/kosmos#5907 (validation queue waits; suites run 30-36 min, not the documented 14-26). Measured
from a queued run on main (comment on the card): the shell stage is 28 min, and `tools/test-browser-check-surface-map.sh`
was its slowest file at 193 s.

## Where the time went
- `split_halves` (the character-by-character awk over the 81k-line page): about 5 s, once.
- `token_web_scan` per declared token: two whole-file `grep -cE` over the code and comment halves, ~0.11 s each, for
  1,071 tokens: about 240 s. Nearly all of the test.

## The change
- `count_plain_tokens`: one awk pass per half counts every PLAIN token (only `[A-Za-z0-9_-]`, the boundary class the
  grep uses) at once. A line splits into maximal runs of that class; a plain token sits between boundaries exactly when
  it is one of those runs, so it is the same match. Each line counts once per token, as `grep -c` counts lines.
- `count_table` joins the two halves' counts into one table (plain = ASCII `[A-Za-z0-9_-]` under `LC_ALL=C`).
  `token_counts` looks a token up there, compared as strings (so `1000` never takes `1e3`'s row), and any token the
  table lacks, for whatever reason, goes to `token_web_scan`: a classifier disagreement costs time, never the answer.
- Each check's annotation is parsed once (`path<TAB>tokens`), and both the table and the per-check loop read that. A
  check file with a tab in its name would not parse (none has one; the old loop allowed it).
- The token reaches awk through the environment, not `-v` (which reads `\101` as `A`); a table row missing a count
  falls back to the grep.
- The CONTROL arms still call `token_web_scan` directly, so the original matcher stays tested. A PARITY arm runs the
  counted path (count_table + token_counts) against it on its own fixture: a token twice on one line and again on
  another, a token inside a longer run, a backslash token that must not take another's row, one in a comment, `1e3` present with `1000` absent, and an absent token. Mutations checked red: the
  per-line dedup, the string compare, an empty table, dropping `-`, `_` or capitals from the counter's class, `-v`
  for the environment, and the per-line reset.
- A check that the real table holds one COMPLETE row (both counts) per distinct plain declared token, so a broken parse (every token on the
  slow grep again) goes red instead of silently slow.
- A spot check of the table's VALUES on the real page: every 40th plain token (22 today) against token_web_scan.
  Mutation: a counter that counts only every other line goes red on 19 of them.
- Temp files now go in one directory the trap removes; the old per-file list was appended in a subshell and removed
  nothing (a fix to a leak older than this change).

## Proof
- The test's full output (1,083 lines) is byte-identical before and after (`diff` clean), apart from the three new
  arm lines (fast path, spot, parity).
- Interleaved on the same load: the original 340 s and 205 s, the new one 13 s and 12 s (load-dependent figures,
  not a contract).

## Rejected
- **Rewriting the per-file loop in awk.** It would also remove the per-token lookup process, but changes how PASS/FAIL
  lines are produced; the lookup costs seconds now, not minutes.

## Weakest premise
- That non-plain tokens stay rare: each still costs two greps. Today two declared tokens are non-plain
  (`data-pmark="xai"` and `data-pmark="gemini"`).

## Rides along: one line for #6017 (2026-10-12 21:0x CDT)
`server.usage.test.js` gains `require('./test-support/tmpscope')` first, byte-identical to the same line on
reportshow-5959, healthline-5959 and bcsgfast-5907. This branch's full validation passed every test and was red only
on the #4273 leak guard finding that file's `aw-usage-route-` dir (#6017, on this Mac under load). A separate PR would
join the back of the validation queue; on every branch already queued, the first to pass lands it and the others drop
it on rebase.
Update (2026-10-13 02:3x CDT): healthline-5959 landed that line first (#6021), so this branch dropped it on rebase onto
main and no longer changes `server.usage.test.js`; the section above is history. Every file this branch changes is
byte-identical to the head it had before the rebase (7745cf8b).
