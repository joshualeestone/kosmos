# sheetrows-8940: a spreadsheet attachment's text keeps each row apart (kosmos#8940)

## Problem (reproduced 2026-11-23, comment on #8940)
`engine/attachtext.js` rendered each sheet as a markdown table whose first row was always the header. A title row
above the real header became the header, and the real column labels a data row ("labels mixed with rows"). Empty rows
were dropped with no row numbers, a line break inside a cell was folded into a space, and booleans read 1/0.

## Decision (written on the card)
One line per row, with the sheet's own row number, each value named by its column:
- Header: the first row holding two or more values, when every value is text (not numeric, TRUE/FALSE or a formula)
  and none repeats. A row with one value above it (a title) is passed over and shown as itself. Otherwise no header,
  and values are named by column letter.
- Under a header every named column is listed, a blank one as `(blank)`; the sheet ends with one line naming the
  blanks (20 rows per column, then a count).
- Inside a value: backslash doubled, a line break as `\n`, a pipe as `\|`, so one line is one row.
- Boolean cells (t="b") read TRUE / FALSE.
- One note says how to read the lines, only when a row was shown.
- Row number: the first cell reference's digits, else the row before plus one (the format's rule). Not `<row r>`:
  `oc.blocks` yields the inside only, and a second walker over hostile input would be a second place to keep linear.

Unchanged: sheet order, every cap, every other note, the worker thread and its limits, the linear readers, docx (still
uses tableInto), pdf.

## Rejected
- Keeping the table and fixing only the header guess: still no row numbers, and columns found by counting pipes.
- JSON: about twice the size, and every model family reads plain lines with cat as well.
- Guessing "required" columns: every blank under a header is listed instead.

## Weakest premise
The header rule: a sheet with no header whose first row is all distinct text gets that row taken as the header. The
header line names its row, so an agent can see it. Residual: a cell whose text is literally "(blank)" reads like an
empty one.

## Tests
- engine/attachtext-8940.test.js (new): the reported shape exactly, a second sheet with a gap / header off column A /
  booleans, the no-header refusals with a control, letter naming, backslash escaping, the blank list cap, unnumbered
  rows, empty sheet, the reading note. Control: 7 of its 8 original tests fail against origin/main's attachtext.js
  (the one that passes, empty sheet, held before too).
- engine/attachtext-6098.test.js: the assertions that pinned the table are rewritten to the exact new lines, each
  keeping what it guarded (pipe escaping, saved formula values, column C, column and sheet caps, partial reads,
  namespace prefixes).
