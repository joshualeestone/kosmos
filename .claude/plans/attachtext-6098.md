# #6098: office attachments (xlsx, docx, pdf) read as text, for an agent of any model family

**Branch:** `attachtext-6098` · **Card:** kosmos#6098 (from feedback, 2026-10-13)

## The defect
An agent reads a text or markdown attachment with `cat` on the path its message names. An office file has no such
reading: an agent unzipped an .xlsx and rebuilt the table from raw XML by hand. Not every model family's command line
reads these files itself.

## The fix
- `engine/attachtext.js` (new): `render(rec)` writes `text.txt` beside a stored xlsx, docx or pdf:
  - xlsx: every sheet in workbook order under `## Sheet: <name>`, as a table (pipes escaped), formulas as saved values;
  - docx: the body's paragraphs and tables in order, headings as `#`, list items as `-`, tracked deletions left out;
  - pdf: page by page (`--- Page N ---`). A pure-JS reader (Flate streams, object streams, the page tree in order with
    inherited resources, fonts with a ToUnicode map, literal/hex strings, Tj/TJ/'/" and line moves). When its text does
    not read as text, a Mac asks macOS's own PDFKit (osascript JXA, subprocess, 20 s timeout). The JS reader goes first
    because PDFKit can join a page's lines into one (measured on a cupsfilter PDF).
  - Every rendering starts with what it is and notes what was not converted (charts, pictures, headers and footnotes, an
    encrypted PDF, scanned pages, an unusual font encoding, a cap reached).
- **Isolation (challenge iteration 1):** the conversion runs in a worker thread (`convertIsolated`, resourceLimits 256 MB
  old generation, 30 s timeout, terminated on timeout). A file that would take too long or too much memory ends the
  worker, never the board's only thread; the rendering then says why. PDFKit runs from the main thread after the worker.
- `engine/attachments.js`: `wireNote` adds `; as text: <path>` inside the bracket when the rendering exists. text.txt is
  NOT reserved (iteration 1: each upload has its own folder and a rendering is only written beside an office file, so it
  cannot collide; reserving it renamed people's own text.txt).
- `server.js` (the attachment PUT): renders before answering, so the message that carries the file can name it; a
  failure never fails the upload.
- `engine/orgchartfile.js`: exports its linear zip and XML readers (no behaviour change).

## Decided, not missed
- **A file beside the attachment, not a new command.** The card asks for "the same command a text attachment uses": that
  command is `cat` on a path in the bracketed line, so the rendering is a path in the same line. Works on Mac and Windows
  and for every model family; nothing new to learn.
- **Rendered on upload, not on read.** The line is typed into the agent's pane synchronously (wireNote); a rendering made
  later could not be named. The upload answers after it (bounded below).
- **Linear readers, caps applied while building** (#4598; iteration 1 found the first version was neither): the docx walk
  is a forward-only finder that counts nesting (nested tables, text boxes; mc:Fallback dropped); output goes through a
  sink that stops at 2 M characters as it is built, one budget for the whole document; each cell keeps at most 32 K
  characters; PDF objects are found by walking `obj` with indexOf and reading the numbers backwards (bounded), number
  patterns elsewhere are bounded (`\d{1,10}`); streams are inflated lazily (only content, ToUnicode and object streams;
  images never), with overflow charged to the 64 MB budget; a content-byte budget (32 MB) counts a shared stream each
  time it is used; CMap tokens are one forward pass, with a budget on entries WRITTEN (200 K) and code length at most 4;
  TJ arrays are kept apart from the operand stack (4,096 items). Growth tests pin each shape the review measured slow.
- **Formula values, not formulas.** The saved value is what a reader needs; the note says so.
- **Iteration 2:** trailing blanks stripped by a loop (a regex was quadratic on a run of spaces) and each PDF line capped while
  built; object-stream offsets must rise and each object ends at the next (text charged to the inflate budget); a sheet part
  listed many times is read once, at most 256 sheets; page, column and cell caps now say so; dates note; conversions limited to
  2 at once; a worker-limits test seam reaches the timeout path; numId 0 is not a list; text-box paragraphs keep a space; a
  damaged docx body says so; a truncated Flate tail keeps what came before. Accepted: per-page resource lookups on a huge Pages
  dict scale with size x pages (measured 0.76 s at 4 MB x 2,000, bounded by the 25 MB upload and the 30 s worker limit).
- **Iteration 3:** the text cap is said when it is reached (later pages are not called scanned); a filter chain is decoded in
  order (ASCII85, ASCIIHex, Flate; reportlab's default is ASCII85 then Flate), and an undecodable PDF says so instead of
  "scanned"; a font with no ToUnicode reads as WinAnsi (curly quotes, dashes, bullets, euro), and control characters where
  text should be send the PDF to PDFKit; the date-format check is a match then a test (no backtracking); PDFKit counts
  against the two-conversion limit; a JS cut note is dropped when PDFKit read the whole file; typed double spaces are kept.
- **Iteration 4:** a font with no ToUnicode and its own encoding (MacRoman from a Mac, /Differences) marks the JS text as not
  trusted: a Mac asks PDFKit; elsewhere a note says symbols may be wrong (a MacRoman table was the alternative). ASCII85 output
  is bounded and charged to the inflate budget; the date note ignores [Red]-style codes and quoted literals.
- **Iteration 5:** a two-byte (Type0/Identity) font with no ToUnicode marks the text untrusted: a Mac asks PDFKit, and elsewhere
  that text is dropped with a note (it would be garbage that reads as text); an encrypted PDF is first offered to PDFKit, which
  opens permission-only PDFs. PDFKit is asked when text does not read as text, a font has its own encoding or no character
  map, or the file is encrypted.
- **Iteration 6:** fonts are judged when a page draws with them, not when listed in (often shared) resources: an unused
  mapless CJK font no longer blanks every page off a Mac. A mapless font's own text is left out (with a note) and the rest
  is kept; own-encoding fonts likewise mark the text only when used. Test for PDFKit's locked answer added.
- **Iteration 7:** a sideways move adds a space only where it leaves room: glyph advances are measured from the font's
  widths (/Widths with /FirstChar; a Type0 font's /W and /DW; a Type3 font's widths scaled by its /FontMatrix), with Tc, Tw
  and Tz, so Chrome and Ghostscript PDFs placed a glyph or a kerned chunk at a time read as words, not "C op yright". A
  symbolic font (descriptor Flags bit 3) with no /Encoding is not trusted as WinAnsi. Notes: each font note on its own
  condition; a page emptied by a mapless font is not called scanned. Measured on 115 local PDFs against the previous
  commit: none gained words or changed flags; 9 lost spurious ones. Decided: letter-spaced headings (CSS letter-spacing)
  stay spaced, as drawn; a PDF that places two words with no gap between them reads them joined, as the file has it.
- **Iteration 8:** a glyph of unknown width (a standard font with no /Widths) makes every sideways move a space again,
  as before iteration 7 (an estimate is off by a word gap); Type0 widths share a 262144-entry document budget (200 fonts
  of [0 65535 500] filled the worker) and a width the budget left out is unknown; inline /DescendantFonts read; the "
  operator sets Tw and Tc. 115 local PDFs against the pre-iteration-7 commit: none gained words.
- **Iteration 9:** the pen (where drawn text ends, user space) is kept across BT/ET and ET adds no space, so a style
  change mid-line (Chrome writes a block per style) is a space only where there is room, and BT x y Td cells (FPDF,
  TCPDF) stay on their line; a line ends only where y moves by more than 0.4 of the font height. Inline images
  (BI ... ID bytes EI) are skipped to the EI with white space on both sides. Kangxi radicals (U+2F00-U+2FDF) from a
  ToUnicode map are NFKC-normalized (macOS Chinese PDFs). 118 local PDFs against bc58a170e: space-before-punctuation
  2309 -> 610, Kangxi 7168 -> 0; the Arabic License's lines, split in two at the same y before, are whole.
- **Iteration 10:** right-to-left text (U+0590-U+08FF and presentation forms, at least 20 and 10% of letters) is drawn in
  visual order, so it is marked: a Mac asks PDFKit (measured: the Hebrew License reads in reading order), elsewhere a
  note says it may read reversed. Arabic and Hebrew presentation forms are NFKC-normalized like Kangxi radicals. The
  `cm` limit is written down under Not done (and in the pageText comment) rather than followed.
- **Iteration 11:** a part over the 20 MB limit (a sheet of ~100k rows, shared strings, a long document) gives its
  first 20 MB with a note, not "could not be read": orgchartfile's unzip getter takes an opt-in `{ prefix: true }`
  (default behaviour unchanged for the org-chart import), which inflates a shrinking prefix of the compressed bytes,
  at most 8 tries. A note when styles carry a percentage or currency format (shown as stored). Latin ligatures
  (U+FB00-U+FB06) normalized. The text-cap note is said once.
- **Iteration 12:** a document cut at the part limit is kept to its last whole paragraph or row and its open tables,
  rows and cells are closed (a table straddling the cut read as nothing); a locale tag like [$-409] on a date format
  no longer reads as currency. Tests for the stored-part prefix and the shared-text note. A part whose 20 MB prefix
  needs more than 8 halvings (a ratio bomb) reads as could-not-be-read: decided, a hostile file.
- **Iteration 13:** an unclosed mc:Fallback tail is stripped before the cut is closed (its later strip took the
  closers with it); any [$-...] locale tag (incl. [$-x-sysdate], [$-x-systime]) is not a currency.
- **Iteration 14:** orgchartfile's stripBlocks removes a self-closed <tag/> alone and does not match a longer tag
  name (a self-closed <mc:Fallback/> took the rest of the document with no note). Shared with the org-chart import's
  rPh strip, where it can only keep more text; orgchart tests pass.
- **Iteration 15:** a formula with no saved result (openpyxl's <v/>) shows as =formula and keeps its row; a workbook
  marked fullCalcOnLoad (openpyxl, xlsxwriter's stored 0) gets "never calculated" instead of the saved-values note.
  A PDF the worker gave up on (time, memory) is still offered to PDFKit on a Mac. mc:Fallback is stripped with nesting
  counted (stripNested, on attachtext's finder/endOf), so a nested Fallback is not read twice.
- **Iteration 16:** a t="str" formula with an empty value is a formula that returned "" (Excel's IF(..,"")), shown
  blank and not counted as uncalculated; the give-up note joins as a sentence; stripNested moved above closeCut's comment.
- **Iteration 17:** a document with tracked changes says so (shown accepted); w:moveFrom is stripped so a moved
  passage reads once; SpreadsheetML with a prefix on its main namespace (<x:row>) is unprefixed before reading;
  w:noBreakHyphen reads as "-" and w:ptab as a tab.
- **Iteration 18:** only a bare <w:tab/> is a tab (iteration 17's pattern also took the tab-stop definitions in
  w:pPr); unprefix works in 1 MB pieces (a 20 MB sheet of tiny prefixed tags passed at a 160 MB heap, where split and a
  global replace both ran out); styles.xml is unprefixed too.
- **Not done:** pictures (no OCR), charts, inline (not referenced) PDF font dictionaries, /Differences glyph names (pdfTeX
  ligatures), LZW, lists and headings applied only through a paragraph style (no numId; localized heading style ids), docx headers/footers/footnotes/comments, text inside PDF form XObjects (`Do`), the `cm` matrix (a line break is decided in the text's own space, so two blocks moved apart only by `cm` can join on one line), right-to-left reading order off a Mac (said in a note),
  xls/doc/ppt/pptx, an attachment uploaded before this change (it gets no rendering; its line is unchanged).

## Weakest premise
That the JS PDF reader's output is right when it "reads as text". A font whose codes happen to land on letters without
being those letters would pass the readability check and be wrong; PDFKit is only asked when the check fails. Real PDFs
from common writers carry ToUnicode maps, which the reader uses.

## Tests (engine/attachtext-6098.test.js, 69 in all; the per-iteration additions are listed at the end. Earlier: three added in iteration 3 (the text cap alone, an ASCII85+Flate chain with
WinAnsi punctuation, the date check on a 200K unclosed format) and the packed-object arm rewritten so it can fail; five added in iteration 2: a 100k-space line, falling ObjStm offsets, a sheet
listed 300 times with 300 columns, the worker timeout through render, docx list/text-box/damaged)
The first 12 (xlsx, docx, simple and modern PDFs, encrypted, no text, end to end through render and wireNote, a text file
unchanged, a damaged xlsx, a person's own text.txt kept) plus nine for review 1: docx growth (20,000 paragraphs, 200,000
empty paragraphs, tables with no paragraphs between); nested table, text box and AlternateContent; a huge shared string
in every cell (capped, quick, says so); PDF digit runs, CMap brackets and repeated full ranges (bounded); a content
stream shared by many pages (charged each time, total capped); a two-digit indirect /Length; a TJ array of 80 items and
two runs on one line; a 70 MB Flate image before the text; a damaged document worded as a document. Meta: engine.reachable
excuses setPdfkit and pdfText as test seams. Neighbours and meta: 161/161 at iteration 8 (attach, orgchartfile, engine.reachable, fixture-discipline, 1732); full validation before the PR. Tests: 69 (iteration 18 added tab stops vs run tabs and a prefixed styles part; iteration 17 added tracked changes and moves, a prefixed workbook, hyphens and ptab; iteration 16 added Excel's empty-string formula beside openpyxl's; iteration 15 added uncalculated formulas, fullCalcOnLoad, PDFKit after a give-up, nested Fallback; iteration 14 added a self-closed Fallback and a longer tag name; iteration 13 added a cut inside a text box's Fallback and sysdate/systime tags; iteration 12 added a table cut at the limit, locale tags, a stored part and shared text over the limit; iteration 11 added a sheet over the part limit, the number-format note, ligatures, the cap note once; iteration 10 added right-to-left text and presentation forms; iteration 9 added style-change blocks, Td cells, inline images, Kangxi; iteration 8 added a no-/Widths standard font and the shared width budget; iteration 7 added glyph-at-a-time words, kerned chunks, Type3 FontMatrix, Type0 /W, symbolic fonts, notes; iteration 6 added an unused mapless font, mixed Latin and mapless text, and PDFKit locked; iteration 5 added CJK no-map and encrypted-through-PDFKit). Iteration 4 added two arms (MacRoman asks PDFKit; [Red] is not a date).
