# pdfpages-8637: flip through every page of a multi-page PDF in the file preview (kosmos#8637)

## Finished looks like
- A PDF with more than one page shows previous and next arrows and "Page N of M" in the preview (Files lists and chat
  attachments alike); the arrow keys flip pages; a swipe flips pages on a touch screen (the phone through Kosmos+ uses this page).
- A one-page PDF, an image, a text file and a spreadsheet look as they do today (control).
- Measured on a real board with a three-page PDF.

## Design (decided)
- qlmanage draws only the first page. Page N (N >= 2) and the page count come from macOS PDFKit through
  /usr/bin/osascript -l JavaScript (built in, measured 0.3 s for page 2 of a 3-page PDF on Mortals). New module
  engine/pdfpages.js: count(file) and render(file, index, out), each a subprocess with a timeout, with a test seam.
- Page 1 stays the qlmanage page, byte for byte (no change for one-page PDFs or anyone on page 1).
- The preview routes take ?page=N. Each PDF answer carries x-kosmos-pdf-pages: M when the count is known; no header
  (count unknown, not a Mac) means the viewer shows one page, as today. A page past the end is a 404.
- Files lists: page N cached in the same per-file folder as the first page, named by the same stamp hash plus -pN, so a
  changed file is drawn afresh and pruning keeps a file's pages together. Attachments: .pdf-page-N.png and the count in .pdf-pages beside
  preview.png (dot names, which safeName never gives an upload, so a PDF uploaded as "pages.txt" cannot be overwritten).
  A Files-list HEAD counts without drawing page 1 (its GET draws it at the same moment).
- The viewer asks the count with a HEAD of the preview address (both routes answer HEAD). Rejected: a JSON info route
  (one more route to gate); reading the count from the image (an img cannot see headers).

## Weakest part
- osascript under a launchd-started board: TCC or a missing GUI session could refuse PDFKit. Then the count is unknown and
  the viewer stays one page (fails closed to today). Must be checked on the real board.
- PDFKit parses an untrusted PDF outside Quick Look's sandbox, so every osascript call runs under sandbox-exec: no
  network, no program started but osascript, writes only into a fresh folder made for that call (never the PDF's own
  folder), nothing read under the account's home but the PDF's folder and that one. Mach-lookup and other IPC are not
  narrowed (AppKit needs them to draw).
  Measured on Mortals 11-17: a page draws inside it, a write elsewhere is refused, and reading ~/.zshrc is DENIED inside
  it and READ outside (control). If a later macOS drops sandbox-exec, nothing is counted or drawn: one page, as before.
- At most two PDFKit runs at once, and the viewer asks for a picture only once the flipping pauses (150 ms).
