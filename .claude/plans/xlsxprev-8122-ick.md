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

## Review round 4 (sonnet): no BLOCKER; 4 WARNINGs, 7 NITs; fixed W1-W4, N1-N3, N6
- W1 a row number that never grows, or cells past column 50, walked a whole 16 MB part (1.9 s a request): MAX_VISITS
  (40000 rows and cells walked per sheet) bounds it; the probe now runs 64 ms. A real-clock test, < 600 ms (1261 ms before).
- W2 a formula returning "" (t="str", empty <v>) read as no saved value: now a saved "". Control: openpyxl's numeric <v/> still is.
- W3 data starting past row 200 showed empty, and a row out of order ended the sheet: the window starts at the first row with
  a value when that is past the cap (new optional `firstRow`, 1-based, only when not 1: told Mona Lisa), rows outside the
  window are skipped, not the end.
- W4 dates showed a time their format hides; h:mm AM/PM was 24-hour; mm:ss showed the hour; serial 0: all as Excel now.
  Three older tests pinned the old display and were corrected (hh:mm:ss shows :00, id 22 shows 00:00, dd/mm/yyyy no time).
- N1 101 decimal places threw out of toFixed (whole workbook refused): over 30 is no format. N2 text under a date format
  showed NaN: shown as written. N3 a self-closed <rPh/> cut the text after it. N6 a shared string past the cap marks the sheet cut.
- KEPT: N4 currency/accounting/scientific show the saved number (decided round 2); N5 hidden sheets shown (decided); N7
  semicolon CSV one column (decided).
- All 5 new r4 tests fail on 9a4fc1923b (run in a scratch copy) and pass now. Every test that reads a changed engine file:
  18 files, 626 tests, 542 pass, 0 fail, 84 skipped (Windows-only).

## Review round 5 (opus): 1 BLOCKER, 4 WARNINGs, 4 CONVENTIONs; all fixed
- B1 a 404 KB file (one 600-char shared string in every cell of 20 sheets) made a 100.6 MB answer; written as `&#1;` it
  could not be stringified and the uncaught throw ENDED the board (attachment route, async handler). Fixed three ways: the
  reader caps its answer's cells as JSON writes them (MAX_OUTPUT_CHARS 2 MiB, all sheets) and clips each shared string
  once; the seam refuses an answer over 8 MiB (covers CSV); the attachment route catches a send that throws. Reviewer's
  own probe on a real board: 2.09 MB / 1.95 MB answers, board alive after (was 100 MB, and exit 1).
- W1 a hostile file cost up to the budget on every request: answers are remembered by content hash (8, LRU, copies out).
  Weakest premise: a refusal from a busy moment is remembered too, until 8 other files are asked for or a restart.
- W2 `cut` was set by formatted blanks past column 50 and by empty far rows: now only when a VALUE is left out.
- W3 the window depended on row order in the file: rows are gathered by number (at most one window held), placed after the walk.
- W4 a date with a time ignored its format's clock (AM/PM, seconds): passed through.
- CONVENTION: the r4 wall-clock test now counts budget checks (work), not milliseconds; false header comments rewritten
  (bounded answer, which scans are unchecked and why); output shape documented with firstRow and someNoValues in both
  files; a test message that could not fire for its stated reason reworded.
- NITs fixed: `empty` with a value only past column 50; t="b" "true"; clip no longer halves an emoji; MAX_VISITS 100000
  (a 300-column sheet showed 133 rows). KEPT (decided earlier): general-format exponent display, `0;(0)`, date codes beyond
  the kinds read, case-sensitive part names (Excel writes lower case), semicolon CSV, Windows lstat/open race (own store).
- All 6 new r5 tests fail on d1c0b92367; the reworked r4 test still fails on 9a4fc1923b. Tests reading the changed engine
  files: 632, 0 fail, 84 skipped. Tests reading server.js's source, run from the repo root: 5525, 0 fail, 138 skipped.
