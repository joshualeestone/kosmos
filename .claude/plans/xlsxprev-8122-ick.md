# xlsxprev-8122-ick: the board serves a spreadsheet's read-only grid (kosmos#8122, parser half)

Seam with Mona Lisa (agreed on the card): the reader and the board routes are this branch; the viewer grid, its wording and its
design are hers. Her reader (83103d8011) is this branch's first commit.

## Change
- engine/xlsxpreview.js: an .xlsx's saved values only, through the checked zip reader (hardened in review 1, below).
- engine/sheetpreview.js: one shape for the viewer; .csv and .tsv through a one-pass RFC 4180 reader with the same caps; fromFile
  reads a stored attachment through one handle (a link refused by lstat, O_NOFOLLOW where present, O_NONBLOCK, the size checked
  before a byte is read).
- engine/filepreview.js `sheet()`: a listed file through the Files lists' own rules and checked read.
- server.js: GET /api/attachment/<id>/sheet; the `sheet` verb on /api/agent/<name>/files/ and `file-sheet` on
  /api/project/<id>/. 404 = not in the list; 200 refusal in words = cannot draw; 403 cross-site.
- Shape: { sheets: [{ name, rows, cut, notGrid? }], moreSheets, noValues, empty, someNoValues? } or { ok: false, because, tooLarge? }.

## Decided
- No library (Mona's call, agreed: no npm dependencies; SheetJS on npm is stale with advisories).
- A refusal the viewer can say is a 200, so the gold button still sits under it.
- someNoValues (added in review 1): a formula with no saved value beside real values, so the viewer can say why cells are blank.
- veryHidden sheets are left out; hidden ones are still shown.

## Review round 1 (opus): 3 BLOCKERs and many WARNINGs, all fixed
Quadratic format-code pattern (a 1.7 KB file hung for minutes); repeated sheet targets and walking past the row cap (a 77 KB
file cost 19 s); openpyxl's `<v />` read as a value; r-less cells; comments and CDATA; docMetadata/; namespace prefixes; single
quotes; any r: prefix; the 1904 system; the 1900 leap-year bug; time-only formats; rPh; float noise; percents; compressed
fixtures; a 2 s work budget; a quoted CSV field bounded. engine/xlsxpreview-review-8122.test.js pins each; against the original
reader 9 of its 10 tests fail.

## Kept (NITs)
UTF-8 CSV only (UTF-16 refused, Latin-1 mis-decoded); a semicolon CSV is one column; a CSV over 2 MB is refused, not head-shown.

## Weakest premise
That the 2 s budget and the caps bound the work on the board's one thread for every file shape; a worker thread would bound it
absolutely.
