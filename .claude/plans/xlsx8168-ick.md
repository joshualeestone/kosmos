# xlsx8168-ick: kosmos#8168, the spreadsheet preview's round-8 leftovers from #8162

All of this concerns XML damaged before zipping; the zip CRC refuses a file damaged after.

## Built

- **W1, a cut sheet list or rels.** The sheet list is now read whole before the per-sheet loop, and a count it raises
  joins `structureCut`, so every sheet, the ones kept included, says `cut: true`. The two not-a-grid paths (a part
  that is not a worksheet, or one missing from the file) now carry `structureCut` instead of a hard `false`, so a rels
  cut that drops a sheet's target says so on that sheet too.
- **W2, a lost start tag.** `elements()` counts a `</name>` that comes before the next `<name` (its start was lost:
  `<si>a</si><t>b</t></si>`), so a lost `<si>`, `<c>` or `<row>` reads as cut, not as another item's value. The next
  close is found once and reused until passed, so a part of self-closed elements (no closes) stays one pass. For
  `<xf>`, whose lost start leaves no close (`<xf/> numFmtId="0"/><xf/>`), `styleKinds` counts any non-space text
  between two styles; any cut in the styles marks every sheet.
- **W3 and the CONVENTION:** tests that fail without `|| structureBeforeStrings` and without the `nearMiss()` call in
  `nestedStart`.

## Not built (the card's NITs)

- `[>100]0;[<=100]0.0` still reads as cut. Flagged, not silent; matching the leniency needs a format-code parser.
- The `startTagEnd` comment about an unclosed quote, and `nestedStart` double counting near-misses: unchanged.

## Weakest premise

That no writer people use puts text between `<xf>` elements in `cellXfs`. The XML schema allows only `<xf>` there;
comments are stripped by `clean()` first. If a real file shows otherwise, the gap check over-reports cut (the safe
direction: a grid said to be partial, never a wrong value said whole).

## Tests

`engine/xlsxpreview-8168.test.js` (6 tests). On main W1 and W2 fail. Mutants: dropping `structureBeforeStrings`, the
`nearMiss()`, the stray-close count (each of si, c, row alone) and the xf gap check each fail their test.
