
## Rebase onto #5165 (2026-10-04, after Baron's review; decided on PR #5119)
#5165 (0.7.22) landed first with its own `/api/project/<id>/file-download` and agent `files/download`, and made a
click over Kosmos+ download any file. Merged as follows:
- **Click over Kosmos+:** a picture or a PDF opens the full-page preview (`filesPvOpen` runs first in every handler).
  Any other file downloads (`kplusDownload`). Both reach the device you are on, which was Josh's need behind #5165.
- **ONE route per path:** `listedFileVerb` serves preview, download and reveal-file for both an agent's Files and a
  project. #5165's separate route blocks are removed, because in server.js the first match wins and the second set
  of checks would have been dead.
- **The download takes any listed file** (#5165's rule replaces this PR's earlier picture-or-PDF-only download, which
  existed only while the preview's Download was its one caller). It goes through this PR's listed-mode gates (no link
  on the path, the list's depth and skipped folders), then #5165's `sendFileDownload`, now opened
  O_NOFOLLOW|O_NONBLOCK and checked with `projects.sameOpenedFile`, with the gates run again and `?check=1`.
- **`sameOpenedFile`** also replaces the inode/device comparisons in resolveListedFile (walked against resolved) and
  in filepreview's readChecked, so a drive that reports inode 0 (Windows FAT/exFAT) compares size and times.
- **Refusals** keep #5165's `refuseDownload`. `resolveListedFile` takes `opts.act` for the verb a refusal says.
  `fileInFolder` stays as a thin alias. `filepreview.download` (the buffered one) is removed; its race tests now drive
  the preview's read, which is the same single-handle path.
- **Rejected:** keeping both handlers (shadowing), and download-on-click for every file (it drops the preview this
  card exists for, and is no safer).
- **Weakest premise:** that no other page code relied on a click downloading a picture or PDF over Kosmos+. Every
  caller of `kplusDownload` was checked: all three run after `filesPvOpen`.
