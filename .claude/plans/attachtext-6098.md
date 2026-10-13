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
- `engine/attachments.js`: `text.txt` is a reserved name (an upload cannot take it); `wireNote` adds
  `; as text: <path>` inside the bracket when the rendering exists.
- `server.js` (the attachment PUT): renders before answering, so the message that carries the file can name it; a
  failure never fails the upload.
- `engine/orgchartfile.js`: exports its linear zip and XML readers (no behaviour change).

## Decided, not missed
- **A file beside the attachment, not a new command.** The card asks for "the same command a text attachment uses": that
  command is `cat` on a path in the bracketed line, so the rendering is a path in the same line. Works on Mac and Windows
  and for every model family; nothing new to learn.
- **Rendered on upload, not on read.** The line is typed into the agent's pane synchronously (wireNote); a rendering made
  later could not be named. The upload answers after it (bounded below).
- **Linear readers only** (#4598): the zip and XML readers are orgchartfile's; the PDF reader walks with indexOf, searches
  `endstream` inside its own object, walks the page tree to depth 64, and caps inflation (64 MB), pages (2,000), sheet
  rows (5,000), columns (256) and output (2 M characters). Growth tests pin two of these; measured 2,000 text pages in
  about 0.1 s.
- **Formula values, not formulas.** The saved value is what a reader needs; the note says so.
- **Not done:** pictures (no OCR), charts, docx headers/footers/footnotes/comments, xls/doc/ppt/pptx, an attachment
  uploaded before this change (it gets no rendering; its line is unchanged).

## Weakest premise
That the JS PDF reader's output is right when it "reads as text". A font whose codes happen to land on letters without
being those letters would pass the readability check and be wrong; PDFKit is only asked when the check fails. Real PDFs
from common writers carry ToUnicode maps, which the reader uses.

## Tests (engine/attachtext-6098.test.js, 12)
xlsx (two sheets, a formula, an escaped pipe, a sheet starting at column C, notes); docx (heading, tab, list, table,
deleted text, picture note); a simple PDF (escapes, TJ spacing, two pages, no PDFKit call); a modern PDF (object stream,
inherited font resources, two-byte ToUnicode with bfchar and bfrange); an encrypted PDF; a PDF with no text (asks
PDFKit once, notes scanned pages); the readability check and its control; end to end for all three (saved, rendered,
named in wireNote); a text file unchanged; a damaged xlsx still gets a rendering that says so; an upload named text.txt
cannot overwrite it; two growth tests. Mutants red: no ToUnicode use; no "as text" in the line; an unbounded endstream
search (growth test, 4.1 s). Meta (engine.reachable: setPdfkit excused as a seam) and 37 neighbouring files: 650/650.
