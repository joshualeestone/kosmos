# sheetgrid-8122: a spreadsheet in the file viewer opens as a read-only grid (kosmos#8122, the viewer half)

## Why, in Josh's words (11-06 12:30, verbatim)
"It'd be nice if we could show a preview of this image. It's a spreadsheet so I don't know why we couldn't render a spreadsheet view. Obviously they couldn't edit it or change it or do anything but just showing something here and then maybe we put the download button right below it."

## The seam (on #8122)
- **Ice Cream Kitty's half:** the reader and the board routes (branch xlsxprev-8122-ick):
  - `/api/attachment/<id>/sheet`, `/api/agent/<name>/files/sheet?name=`, `/api/project/<id>/file-sheet?name=`;
  - each answers `{ ok: true, sheets: [{ name, rows, cut, notGrid?, firstRow? }], moreSheets, noValues, someNoValues, empty }` or `{ ok: false, because, tooLarge? }`.
- **This branch (mine):** the viewer's grid and its words.
- The gold Download button under the file shipped in #8139.

## Change
- `pvSheetUrl` picks the route: an attachment's from its own `/api/attachment/<id>`, a Files-list file's from its list (`sheetUrl`). Only .xlsx, .xlsm, .csv and .tsv.
- `pvStageKind` returns `sheet` for those.
- `pvSheetLoad` says "Opening the spreadsheet..." while it reads.
  - Then it draws the grid.
  - A file the board cannot draw shows its card with the board's sentence, and the gold button stays under it.
  - A failed read shows the card.
  - An answer that arrives after the viewer closed draws nothing.
- `pvSheetInto` draws a light, read-only sheet on the dark:
  - sticky column letters and row numbers (starting at `firstRow` or 1);
  - numbers right-aligned, a long cell cut with an ellipsis;
  - the sheets as tabs, with the arrow keys moving between them (the tab pattern, ARIA tablist and tabpanel);
  - every word set as text, never markup;
  - a note for each state: cut short, more sheets, some or all values not saved, empty, a chart sheet.

## Not in this branch
The reader and routes (Kitty's). Word files keep the card. The iPhone already previews spreadsheets with Quick Look.

## Tests
render-file-preview-4930 `runSheet`, on Chromium and WebKit, against a stubbed route: the grid and its tabs, markup shown as text, the notes, the arrow keys, firstRow, and "too large" showing the card and its sentence.
