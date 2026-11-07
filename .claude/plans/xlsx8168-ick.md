# xlsx8168-ick: kosmos#8168, the spreadsheet preview's round-8 leftovers from #8162

All of this concerns XML damaged before zipping; the zip CRC refuses a file damaged after.

## Built

- **W1, a cut sheet list or rels.** The sheet list is walked whole, inside `<sheets>`, before the per-sheet loop, so
  a count it raises is in `structureCut` and every sheet in the answer, the ones kept included, says `cut: true`. Only the first
  MAX_SHEETS shown sheets are held; the rest are counted for `moreSheets`. The two not-a-grid paths (a part that is
  not a worksheet, or one missing from the file) carry `structureCut` instead of a hard `false`.
- **W2, a lost start tag.** `elements()` counts a `</name>` found after the last element yielded and before the next
  `<name`, or after the last one (a lost `<si>`, `<c>` or `<row>`). Closes are searched from the last element's end
  (a near-miss moving the scan on cannot skip one), once, reused until passed, so a part of self-closed elements
  stays one pass. In list mode (`sheet` in `<sheets>`, `Relationship` in `<Relationships>`, `numFmt` in
  `<numFmts>`, `xf` in `<cellXfs>`), any non-space text between two items or after the last is counted: a lost start
  of a self-closed element leaves only its attributes. A cut in the workbook, rels or styles marks every sheet.
- **A lost container.** With `<sheets>` or `<Relationships>` lost but its items in the part, they are read from the
  whole part as before #8168 and the loss is counted (`listItems`), so nothing reads as empty. `numFmt` cannot take
  that rule (a `<dxf>` holds them legitimately), so a style naming a custom format (id 164 and up) that no `<numFmt>`
  defines is marked lost, and counted where a cell formats a number with it: it covers a lost `<numFmts>` and any
  other lost format, and a style no cell uses cuts nothing.
- **Found on the way:** reading `numFmt` only inside `<numFmts>` stops a `<dxf>` (a conditional format) overwriting the
  cell format of the same id; on main a date read as `4500000.00%`. Pinned by a test.
- **W3 and the CONVENTION:** tests that fail without `|| structureBeforeStrings` and without the `nearMiss()` call in
  `nestedStart`.

## Not built

- **The screen (#8188).** `pvSheetInto` in `web/index.html` returns before the cut note on a not-a-grid sheet and on
  an empty one, so on those two paths `cut: true` is in the answer but not on screen. Kept out of this reader change
  on purpose (a `web/index.html` change has its own gates); filed for the grid's owner.

The card's NITs:

- `[>100]0;[<=100]0.0` still reads as cut. Flagged, not silent; matching the leniency needs a format-code parser.
- The `startTagEnd` comment about an unclosed quote, and `nestedStart` double counting near-misses: unchanged.
- `si` is not read in list mode: `<sst>` may hold an `<extLst>` after its items, which list mode would count as cut.
  So a lost start of an empty self-closed `<si/>` (only `/>` left) still shifts later indexes silently, as on main.

## Weakest premise

That no writer people use puts anything but its items (and space) inside `<sheets>`, `<Relationships>`, `<numFmts>`
or `<cellXfs>`, and that every writer defines the custom formats (164 and up) its styles use. The schema requires
both; comments are stripped by `clean()` first. The two real
workbooks in test-support/xlsx read with no cut. If a real file shows otherwise, the gap check over-reports cut (the safe
direction: a grid said to be partial, never a wrong value said whole).

## Tests

`engine/xlsxpreview-8168.test.js` (15 tests). On main W1 and W2 fail. Mutants each fail a test: no
`structureBeforeStrings`, no `nearMiss()`, no stray-close count (si, c, row alone), no list mode at each of the four
sites, no check after the last item, a stray search from the scan point instead of the last element's end, and no
MAX_SHEETS cap on the held list, no count or no fallback read for a lost container, no lost-format check, and
`numFmt` read from the whole styles part, no per-cell lost-format count, and no cached close search (95,000
self-closed cells then pass the work budget and are refused). An Excel 365 shaped workbook, rels and styles read with no cut.
