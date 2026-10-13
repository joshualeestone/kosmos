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
- **Not done:** pictures (no OCR), charts, docx headers/footers/footnotes/comments, text inside PDF form XObjects (`Do`),
  xls/doc/ppt/pptx, an attachment uploaded before this change (it gets no rendering; its line is unchanged).

## Weakest premise
That the JS PDF reader's output is right when it "reads as text". A font whose codes happen to land on letters without
being those letters would pass the readability check and be wrong; PDFKit is only asked when the check fails. Real PDFs
from common writers carry ToUnicode maps, which the reader uses.

## Tests (engine/attachtext-6098.test.js, 21)
The first 12 (xlsx, docx, simple and modern PDFs, encrypted, no text, end to end through render and wireNote, a text file
unchanged, a damaged xlsx, a person's own text.txt kept) plus nine for review 1: docx growth (20,000 paragraphs, 200,000
empty paragraphs, tables with no paragraphs between); nested table, text box and AlternateContent; a huge shared string
in every cell (capped, quick, says so); PDF digit runs, CMap brackets and repeated full ranges (bounded); a content
stream shared by many pages (charged each time, total capped); a two-digit indirect /Length; a TJ array of 80 items and
two runs on one line; a 70 MB Flate image before the text; a damaged document worded as a document. Meta: engine.reachable
excuses setPdfkit and pdfText as test seams. Neighbours and meta: 666/666.
