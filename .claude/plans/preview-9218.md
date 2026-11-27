# kosmos#9218: `kosmos preview <file>` renders a project PDF page to a PNG

## Why (from the card)
A coordinating agent should be able to look at a design itself before relaying that it is ready. Today it has to find a
PDF tool on the machine, which differs per platform. Mac, Linux and Windows; never send the file anywhere; print the
PNG path.

## Measured on origin/main (11-27 09:3x)
- engine/filepreview.js `preview(folder, name, where, opts)`: a PDF's first page via attachments.renderPdf (macOS
  /usr/bin/qlmanage, subprocess, 10 s timeout), later pages via engine/pdfpages.js (PDFKit through osascript under
  sandbox-exec, MAX_PAGES, a timeout, MAX_AT_ONCE). It works on a private copy (withPrivateCopy) and caches under the
  board's data folder. Non-darwin: attachments.hasRenderer() is false, nothing is drawn.
- Size limit: filepreview's MAX_PREVIEW_BYTES / tooBig.

## Shape (decided; reasons on the card)
- engine/pdfpreview.js (new): render(file, page, out) -> { ok, path } | { ok:false, because }.
  - darwin: reuse attachments.renderPdf (page 1) and pdfpages.render (page N) on a private copy, as filepreview does.
  - win32: PowerShell 5.1 (`powershell.exe -NoProfile -NonInteractive -Command`) loading Windows.Data.Pdf
    (StorageFile.GetFileFromPathAsync, PdfDocument.LoadFromFileAsync, page.RenderToStreamAsync to a PNG file stream),
    file, page and out passed as arguments, never spliced into the script. Timeout. Measure on the Windows box.
  - linux: `pdftoppm -f N -l N -png -singlefile -r 110` or `mutool draw -o out -F png file N` if on PATH; else
    refuse naming the package (poppler-utils / mupdf-tools).
- CLI: install/kosmos and tools/windows/kosmos-cli.js `kosmos preview <file> [--page N] [--out <png>]`; default out
  in the agent's own folder (not Files, which the person sees), printed. Refuse a path outside the agent's project
  folders or its Files folder (as attachments do: resolve, no symlink escape), a non-PDF, a file over the limit.
- Never the network: only local subprocesses; the Mac path keeps its sandbox.

## Tests to write
- engine: the platform dispatch with each renderer seamed (as attachments' test seam); refusals (outside folder,
  symlink escape, not a PDF, too big, page out of range); argument passing (a file name with quotes and $ reaches the
  subprocess as one argument).
- darwin, real: render page 1 and page 2 of a small real PDF (make it with the board's own fixture or a checked-in
  one), assert a decodable PNG (memory: an undecodable fixture manufactures a symptom).
- CLI: both CLIs parse --page/--out and print the path; unknown options refused.
- Windows: run on the Windows box (Homer) at the V2, or park that half with the reason.

## Open
- Whether `kosmos preview` should also take an image (just copy/resize) or only PDF: start PDF only.

## Built (11-27 09:30 to 09:58), and what changed from the shape above
- DROPPED: the refusal of a file outside the agent's project folders or Files. `kosmos reply --file` has that rule
  because it SENDS a file to a person; preview sends nothing, runs with the agent's own rights (which already read any
  file it names), and the check needs the board's roster, so the board would have to be running. Kept: PDF only (its
  `%PDF-` header), the board preview's 25 MB limit, a regular file, page range.
- Default out: a new mkdtemp folder of the system's temporary folder, not the agent's folder (the CLI cannot know
  which folder is the agent's without the board, and a temp folder is never seen by the person).
- macOS draws every page through pdfpages (page 1 too), not qlmanage for page 1: one sandboxed renderer.
- Review 2: a PDF locked with a password drew blank white pages with exit 0 on a Mac; engine/pdfpages.js now answers
  ERR locked, which also stops the board's own preview drawing blank later pages for it. mutool's page count is read
  before drawing (it may clamp a page past the end). --out is compared to the PDF by device and inode.
- Static guards: rawwrites baseline +1 (the private temp copy, read once and removed); #1732 inventory row for
  pdfpreview's undefined-safe O_NONBLOCK.

## Measured
- Mac (PDFKit) and Linux (pdftoppm, forced) on a real three-page PDF: the right page, decoded at 1024 tall.
- Windows: Homer on the Windows box at 5912a6de11 (node 24, Windows PowerShell 5.1): page 2 drawn and shows PAGE 2,
  page 999 refused with the count (exit 2), page 1 control. Not tried there: locked, damaged, large, non-ASCII Temp.
- Not measured anywhere: mutool (not installed on this Mac); its `info` output format (Pages: N) is reasoned.

## Accepted residual
- A locked PDF the board counted BEFORE this change keeps its stored count, so a later-page request reaches render,
  which now fails ("could not draw that page") and is not remembered: one sandboxed osascript run per such request.
