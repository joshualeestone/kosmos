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
- Under a header every named column is listed, a blank one as `(blank)`. One line naming the blanks (20 rows per
  column, then a count) comes first, under the sheet's heading, so a sheet cut short by the output cap keeps it.
- Inside a value: backslash doubled, a line break as `\n`, a pipe as `\|`, so one line is one row.
- Boolean cells (t="b") read TRUE / FALSE.
- One note says how to read the lines (including that \\ is one backslash), only when a row was shown.
- Row number: the row's own `r`, else its first cell reference's digits, else the row before plus one (the format's
  rule). `oc.blocks` takes an optional callback that is handed the opening tag it already found, so no second walk
  over the file is needed (round 1 of review).
- A row whose cells hold only spaces is left out, as an empty row is; a header cell of only spaces is ignored by the
  header rule; U+0085, U+2028 and U+2029 are escaped as \n too; a sheet name goes through the same escaping.

Unchanged: sheet order, every cap, every other note, the worker thread and its limits, the linear readers, docx (still
uses tableInto), pdf.

## Rejected
- Keeping the table and fixing only the header guess: still no row numbers, and columns found by counting pipes.
- JSON: about twice the size, and every model family reads plain lines with cat as well.
- Guessing "required" columns: every blank under a header is listed instead.

## Weakest premise
The header rule, both ways. A sheet with no header whose first row is all distinct text gets that row taken as the
header; a real header that holds a number (`Region | 2023 | 2024`) is refused, and the sheet is named by column
letters. The header line names its row, so an agent can see which happened. Residuals, all rare: a cell whose text is
literally "(blank)" reads like an empty one; a header word that is itself a column letter, or that contains ": ",
reads like the separator or a letter-named value. A one-column sheet never has a header (the rule needs two
values), so its column is named A; nothing else is lost, since a blank cell there is an empty row, which is skipped.

## Tests
- engine/attachtext-8940.test.js (new): the reported shape exactly, a second sheet with a gap / header off column A /
  booleans, the no-header refusals with a control, letter naming, backslash escaping, the blank list cap, unnumbered
  rows, empty sheet, the reading note. Control, measured at baaa14b35a with origin/main's attachtext.js and orgchartfile.js swapped in:
  17 of its 18 tests fail; the one that passes (an empty sheet says so) held on main too.
- engine/attachtext-6098.test.js: the assertions that pinned the table are rewritten to the exact new lines, each
  keeping what it guarded (pipe escaping, saved formula values, column C, column and sheet caps, partial reads,
  namespace prefixes).
