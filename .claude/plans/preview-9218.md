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
