# xlsx8147-ick (kosmos#8147): the spreadsheet preview's round-8 leftovers from #8122

Stacked on PR #8151 (xlsxprev-8122-ick); retargeted to main and rebased once #8151 merges.

## What it does
- Near-miss tags in `elements()` and text runs in `textOf()` count toward caps (1M, 4M per read) and the time budget.
- Never "empty" / "noValues" when something was not read (a walk cut at MAX_VISITS; a row or cell not placed: past
  row 1048576, or a start tag too long to read), or when a formula saved "" (same answer for t="str", shared, inline).
- Number formats: a trailing thousands comma is shown as saved; multi-section codes draw positives by the first
  section and negatives by a simple second section with its sign (brackets, a written minus, else a minus, because
  this preview shows no colour and a negative must never read as positive); zero sections; quotes in sections; -0;
  .50 / #.00; "#" shows no zero; a negative time is shown as saved.
- Row numbers decimal (spaces trimmed); the answer cache bounded by total size as well as count.

## Review: 8 rounds, cap stop (usage rule), no BLOCKER open at round 8
- r1 (opus) 3W: multi-section formats lost formatting for positives (my own first cut), #.00, "" formula -> fixed.
- r2 (sonnet) 2W: "" formula still "no values"; negative percent -> fixed.
- r3 (opus) 7W: an 8+ digit row landed on the next row (my round-2 regression), text runs uncounted, t="str" "",
  percent zero, "#" zero -> fixed.
- r4 (sonnet) 1W: negative percent sign -> drawn by the second section.
- r5 (opus) 1 BLOCKER: my r4 fix showed -5 under "0.00;[Red]0.00" as 5.00 (a loss as a gain) -> the second section's
  sign is always drawn. Also 41-digit rows, capped formulas with no values.
- r6 (sonnet) 2W: a long start tag placed a row on another row; a negative time read as positive -> fixed.
- r7 (opus) 2W: unread cells/rows with a formula alone left the flags wrong -> one `skipped()` helper.
- r8 (sonnet): no BLOCKER; a saved value with attributes in a skipped row, a cut-off cell read as empty, 2 NITs ->
  carried to #8162. Round 8's fuzz: 300,000 codes x 20 values, 0 negatives shown as positive.
