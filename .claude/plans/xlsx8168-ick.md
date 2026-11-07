# xlsx8168-ick: kosmos#8168, the spreadsheet preview's round-8 leftovers from #8162

All of this concerns XML damaged before zipping; the zip CRC refuses a file damaged after.

## Built

- **W1, a cut sheet list or rels.** The sheet list is walked whole, inside `<sheets>`, before the per-sheet loop, so
  a count it raises is in `structureCut` and every sheet, the ones kept included, says `cut: true`. Only the first
  MAX_SHEETS shown sheets are held; the rest are counted for `moreSheets`. The two not-a-grid paths (a part that is
  not a worksheet, or one missing from the file) carry `structureCut` instead of a hard `false`.
- **W2, a lost start tag.** `elements()` counts a `</name>` found after the last element yielded and before the next
  `<name`, or after the last one (a lost `<si>`, `<c>` or `<row>`). Closes are searched from the last element's end
  (a near-miss moving the scan on cannot skip one), once, reused until passed, so a part of self-closed elements
  stays one pass. In list mode (`sheet` in `<sheets>`, `Relationship` in `<Relationships>`, `numFmt` in
  `<numFmts>`, `xf` in `<cellXfs>`), any non-space text between two items or after the last is counted: a lost start
  of a self-closed element leaves only its attributes. A cut in the workbook, rels or styles marks every sheet.
- **W3 and the CONVENTION:** tests that fail without `|| structureBeforeStrings` and without the `nearMiss()` call in
  `nestedStart`.

## Not built (the card's NITs)

- `[>100]0;[<=100]0.0` still reads as cut. Flagged, not silent; matching the leniency needs a format-code parser.
- The `startTagEnd` comment about an unclosed quote, and `nestedStart` double counting near-misses: unchanged.

## Weakest premise

That no writer people use puts anything but its items (and space) inside `<sheets>`, `<Relationships>`, `<numFmts>`
or `<cellXfs>`. The schema allows only those elements there; comments are stripped by `clean()` first. The two real
workbooks in test-support/xlsx read with no cut. If a real file shows otherwise, the gap check over-reports cut (the safe
direction: a grid said to be partial, never a wrong value said whole).

## Tests

`engine/xlsxpreview-8168.test.js` (11 tests). On main W1 and W2 fail. Mutants each fail a test: no
`structureBeforeStrings`, no `nearMiss()`, no stray-close count (si, c, row alone), no list mode at each of the four
sites, no check after the last item, and a stray search from the scan point instead of the last element's end.
