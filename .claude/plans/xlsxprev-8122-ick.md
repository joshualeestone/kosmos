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

## Review round 2 (sonnet): 1 BLOCKER, 3 WARNINGs, fixed
- BLOCKER: `clean()` ran two indexOf searches per pass, so a part full of empty comments (or CDATA) was quadratic: a 25 KB
  file ran 40 s+, and the budget could not stop one call. Now one forward scan for "<". A real-clock test (2 MB of comments,
  of CDATA, of unclosed tags, each under 1 s) fails at 29 s on the round-1 reader.
- WARNING: "[h]:mm" durations were taken modulo a day (1.5 showed 12:00, Excel 36:00). Now total hours, minutes or seconds.
- WARNING: simple number formats ignored. Now "0.00", "#,##0", "0%", "0.0%" and built-ins 1-4, 9, 10 show their decimals,
  thousands and percent, rounded as Excel does; locale date formats 27-36 and 50-58 are dates; a time just before midnight
  carries into the next day. KEPT: currency, fractions, scientific, conditional sections show the saved number.
- WARNING: the zip reader refused a whole workbook for an entry it never reads ("[trash]/", "_xmlsignatures/", a name Windows
  cannot store). engine/win32zip.js gains an opt-in `skipUnsafeNames` for a read-only lister (never extractZip): such an entry
  is left out of the listing; every other check (encryption, links, sizes, totals, overlap) still refuses. Mona's test for
  "an unexpected top-level entry" now checks the entry is never read rather than that the file is refused.
- NITs: a budget check every 1024 steps in every loop (styles, rels, sheets, rows, cells, shared strings).

## Review round 3 (opus): no BLOCKER; 2 WARNINGs, 4 CONVENTIONs, fixed
12 hostile 15 MB-part workbooks (23-93 KB files) all linear and inside the budget (worst 1.85 s, styles, now memoized).
- WARNING: a t="d" ISO date cell showed "NaN" --> shown as its date (time kept when not midnight).
- WARNING: a sheet whose part is missing (damaged, or a name the lister skips) read as "empty" --> notGrid.
- CONVENTION: the skip comment overstated the checks --> it names what still runs; extractZip throws on the flag.
- CONVENTION: no win32zip test of the mode --> added (listing, default refuses, extractZip refuses the flag).
- CONVENTION: the size-before-read test could not fail --> it counts fs.readSync calls (0 for a file over the cap).
- CONVENTION: currency and units were dropped from the shown text --> only digit-placeholder codes are formatted.
- KEPT (NITs): numbers past 15 digits, multi-section codes (negatives in parentheses, ";;;" hide), "[h]" alone, "#.00",
  AM/PM in 24-hour form, serial 0-1 under a date, negative 1900 durations, a CSV trailing blank line at the row cap marked cut,
  the long unquoted CSV field path (linear, about 10x the quoted one), no per-file cache of a sheet answer.
