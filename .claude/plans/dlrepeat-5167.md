# dlrepeat-5167: "Cannot create file" says why (kosmos#5167, the operator's 11-06 failure)

## What happened (Splinter's comment, 11-06 12:04 CST)
On the operator's laptop Mac app, connected to another computer's board through Kosmos, saving a 67 KB spreadsheet
twice gave "Kosmos could not save that file. The file could not be saved to Downloads (Cannot create file)." Earlier
saves in the same session had worked (name, (2), (3) in Downloads), the failed file had a new name, and restarting
Kosmos cleared it (Splinter, 12:32). So: state in the app session, cause unknown.

## Measured here
- **The repeat theory is out** (Splinter disproved it; numbering works). Here too: a real-WebKit probe (the download
  selftest with five saves of one file then a new name, the Kosmos+ mark on) saved all six, no failure.
- **The alert drops the cause.** Forcing a create failure (the download folder made unwritable for one click) gives
  exactly the operator's alert, and WebKit's error carries the real reason under it:
  `NSURLErrorDomain -3000 "Cannot create file"`, `NSUnderlyingError: NSPOSIXErrorDomain 13 "Permission denied"`. The
  app showed only the top line, so neither the operator nor we can tell what refused the file.
- **The app's #5167 log lines go nowhere on a real Mac.** `logLine` writes only the test harness's file (#5481), so the
  operator's Mac recorded none of them; "read the laptop's app log" cannot work.

## Built
- `downloadFailureWords(error)` (pure): WebKit's words, then the system's reason when WebKit gives one (a POSIX error
  under NSUnderlyingErrorKey, in libc's fixed words: "Permission denied", "File exists", "No space left on device").
  The alert now reads "... (Cannot create file: Permission denied)". Nothing else from the error is shown: its other
  details carry the download's address, and with it the board token.
- `downloadFailureCodes(error)` (pure) and one `logToSystem` line: "#5167: a download failed (NSURLErrorDomain -3000,
  NSPOSIXErrorDomain 13)", in domains and numbers only, so it is kept on a person's Mac (#5481's rule: no address, no
  file name).

## Decided
- **Diagnose, not guess a fix.** The cause is session state I could not reproduce (connect mode over Kosmos+, the
  release build, the operator's Mac); a restart cleared it. The next occurrence now names its own cause on screen,
  which is what an unreproduced failure needs first. Rejected: retrying a failed create (could save twice or over a
  file), and the earlier `exists` change (disproved).
- The operator's own screenshot is enough next time; nobody needs to read his Mac's log.

## Weakest premise
That WebKit attaches a POSIX reason for the operator's failure too. Measured for a permission refusal here; if his cause
has no underlying error, the alert reads as before and only the unified-log codes add anything.

## Tests
- `--kosmos-app-mode-selftest` (+7 rows, 233): the reason shown for EACCES and EEXIST, and one found a level further down (review 1); CONTROL: no reason under it,
  WebKit's words alone; a non-POSIX reason is not shown; codes only in the log line; neither carries the address/token.
- `--kosmos-app-download-selftest` (+1 row, 39): a real WKWebView click into an unwritable folder says
  "(Cannot create file: Permission denied)", once; the failure tally rises to 8. Mutant (the old words) fails both.
- `native-app.applog-5481.test.js`: the new unified-log caller is pinned (6 callers). `native-app.download-5167.test.js`:
  the row counts follow (233, 39). Both 34/34.
