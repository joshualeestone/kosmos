---
pre_challenge: true
method: challenge-loop
branch: pdfpages-8637
diff_hash: a1fb99581113bf1b31e5f6320b2196961bb9ba0739853df93a9337f99fedfd56
validation: passed (targeted 25-file list, 523 pass 0 fail at 4e33eb9c; NOT the full suite: a full-suite hold is on Mortals, so CI runs the full suite)
subdir_audit: not run (no subdirectory CLAUDE.md changed)
timestamp: 2026-11-17T17:29:32Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by the fleet's standing review cap ("8 rounds unless a BLOCKER is open"); no BLOCKER was open (the one BLOCKER, iteration 1, is fixed). Iteration 8 still raised one new WARNING, fixed in 4e33eb9c, so the last fix has not itself been reviewed by a further pass.
**Total findings (BLOCKER/WARNING/CONVENTION):** 1 BLOCKER, 19 WARNINGs, 2 CONVENTIONs, plus NITs
**Fixed:** 17 | **Deferred:** 5 (counting repeats once) | **Asked:** 0

Origin column: the per-finding blame lookup (6c-bis) was not run in this loop, so every row is recorded BRANCH, the fail-safe default. Several later findings were plainly about earlier fix commits (the sandbox, added in iteration 5, was the subject of iterations 6 to 8).

Validation note: the canonical helper runs the full suite, which the Mortals hold forbids (Liu Kang m7609), so each iteration was validated with the targeted list (the changed files' own tests, every test that lifts the preview code, and the source-scan guards: fixture-discipline, engine.reachable, windows-tests-1777, cli.exit-code-mapping-3628, caches.fsync-5434, web.api-routes-3957).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [BLOCKER] engine/attachments.js — a PDF uploaded as "pages.txt" would be overwritten by its own count --> FIXED (9708f0c5: dot names .pdf-pages / .pdf-page-N.png, refused by safeName and storedAsIs; test)
- [WARNING] engine/filepreview.js — the viewer's HEAD drew page 1 alongside its GET (three copies, two Quick Look runs) --> FIXED (9708f0c5: count-only HEAD; test)
- [WARNING] engine/filepreview.js — count not kept without page 1, so each flip copied twice --> FIXED (9708f0c5)
- [WARNING] web/index.html — Kosmos+ relay passing HEAD and the header is unproven --> DEFERRED: fails safe to one page; relay is outside this repo; listed as unverified in the plan and PR, to check on a live board
- [CONVENTION] engine/attachments.js safeName comment stale --> FIXED (9708f0c5)
- [CONVENTION] engine/pdfpages.js pageOf comment wrong --> FIXED (9708f0c5)
- [NIT] stale pvFlip after page-1 failure --> fixed; [NIT] mobile-shots temp words file on failure --> fixed; others noted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] engine/filepreview.js — rmdirSync of the cache folder on a failed count could race a concurrent request --> DEFERRED: rmdirSync removes only an empty folder, the same pattern as the existing page-1 failure path (#4997 review 10); the race costs one retried view
- [WARNING] web/index.html — only three exact address shapes are asked for a count; drift would silently drop the arrows --> FIXED (d9a13e74: test builds the real addresses from filesPvOpen and attachments.rowField)
- [WARNING] server.js — ?page= refused for images and text --> FIXED (d9a13e74: refused by the PDF path only; image control test)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] server.pdf-pages-8637.test.js — unread-count assertion checked a file name the code never writes (could never fail) --> FIXED (2498606b: checks .pdf-pages, with a control that a good count is kept)
- [NIT] plan named old file names --> fixed; [NIT] failed later page showed a broken image --> fixed; [NIT] attachment HEAD dedupe comment --> added

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] later pages kept without limit per PDF --> FIXED (13b74785: keepNewestPages, 40 per PDF; test)
- [WARNING] a failed count retried on every open --> DEFERRED in this iteration (page 1 never waits on it); later fixed in iteration 6
- [WARNING] image/text HEAD and page behaviour not pinned on Files lists --> FIXED (13b74785: test)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] no limit on concurrent PDFKit runs; a held arrow key starts dozens --> FIXED (f665105b: at most two at once; the viewer asks for a picture once flipping pauses; tests)
- [WARNING] untrusted PDFs parsed by PDFKit outside any sandbox --> FIXED (f665105b: sandbox-exec, no network, writes only to the output folder, no reads under home but the PDF's and output's folders; measured on Mortals with a negative control)
- [NIT] a hidden failed page blocked swipes --> fixed (opacity)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs (plus a repeat of the iteration-1 Kosmos+ item, deferred)
**Self-generated:** 0 (recorded BRANCH; the finding concerned iteration 5's sandbox)
- [WARNING] a failed count (for example a sandbox refusal) retried on every open, up to 10 s --> FIXED (f31c74d8: failure remembered ten minutes per key; tests)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs (plus the Kosmos+ repeat, deferred)
**Self-generated:** 0 (recorded BRANCH; both concerned iteration 5's sandbox)
- [WARNING] the sandbox did not stop starting other programs, and its comment overstated containment --> FIXED (6baf3c67: process-exec denied but osascript, measured with a control; the comment says mach-lookup and IPC are not narrowed)
- [WARNING] for an attachment the sandbox's writable folder was the folder holding the upload --> FIXED (6baf3c67: each draw and count writes only into a fresh folder of its own; test)
- [NIT] cupsfilter seed had no timeout --> fixed; [NIT] HEAD-200 semantics and the not-once listener --> commented

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs (plus repeats: Kosmos+ deferred; the rmdir race deferred in iteration 2)
**Self-generated:** 0 (recorded BRANCH)
- [WARNING] a sandbox that breaks on another macOS would lose the feature silently --> FIXED (4e33eb9c: said once per board run, without the file's name; test)
- The plan's phone claim was softened to say the Kosmos+ path is not measured.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/attachments.js | BRANCH | upload named pages.txt overwritten by its count | FIXED | 9708f0c5 |
| 2 | 1 | WARNING | engine/filepreview.js | BRANCH | HEAD drew page 1 beside the GET | FIXED | 9708f0c5 |
| 3 | 1 | WARNING | engine/filepreview.js | BRANCH | count not kept without page 1 | FIXED | 9708f0c5 |
| 4 | 1 | WARNING | web/index.html | BRANCH | Kosmos+ HEAD/header unproven | DEFERRED | fails safe; live check owed |
| 5 | 1 | CONVENTION | engine/attachments.js | BRANCH | safeName comment stale | FIXED | 9708f0c5 |
| 6 | 1 | CONVENTION | engine/pdfpages.js | BRANCH | pageOf comment wrong | FIXED | 9708f0c5 |
| 7 | 2 | WARNING | engine/filepreview.js | BRANCH | rmdir race on failed count | DEFERRED | empty-only rmdir, existing pattern |
| 8 | 2 | WARNING | web/index.html | BRANCH | address shapes could drift silently | FIXED | d9a13e74 |
| 9 | 2 | WARNING | server.js | BRANCH | ?page refused for non-PDFs | FIXED | d9a13e74 |
| 10 | 3 | WARNING | server.pdf-pages-8637.test.js | BRANCH | assertion could never fail | FIXED | 2498606b |
| 11 | 4 | WARNING | engine/attachments.js, filepreview.js | BRANCH | unbounded later pages | FIXED | 13b74785 |
| 12 | 4 | WARNING | web/index.html | BRANCH | failed count retried each open | FIXED | f31c74d8 (iteration 6) |
| 13 | 4 | WARNING | server.js | BRANCH | non-PDF HEAD not pinned | FIXED | 13b74785 |
| 14 | 5 | WARNING | engine/pdfpages.js | BRANCH | unbounded concurrent PDFKit runs | FIXED | f665105b |
| 15 | 5 | WARNING | engine/pdfpages.js | BRANCH | PDFKit unsandboxed | FIXED | f665105b |
| 16 | 6 | WARNING | engine/pdfpages.js | BRANCH | failed count not remembered | FIXED | f31c74d8 |
| 17 | 7 | WARNING | engine/pdfpages.js | BRANCH | sandbox allowed starting programs | FIXED | 6baf3c67 |
| 18 | 7 | WARNING | engine/attachments.js | BRANCH | upload's folder writable to PDFKit | FIXED | 6baf3c67 |
| 19 | 8 | WARNING | engine/pdfpages.js | BRANCH | silent sandbox failure | FIXED | 4e33eb9c |

### Outstanding questions (ASKED)
- None.

### Owed outside this loop
- A live check through Kosmos+ that the HEAD and x-kosmos-pdf-pages reach the phone (ledger 4).
- The card's real-board check (three-page PDF flips with arrows and keys, count right; one-page PDF and image unchanged).

### NITs (non-blocking, across all iterations)
- Attachment and Files-list counts use different flushed writers (store.saveFlushed vs securewrite.writeSecret) (iterations 1, 5)
- Stale render temp folders after a crash are reclaimed only by sweep or the attachment's removal (iterations 2, 3)
- runScript failures beyond the first are not logged (iteration 2; partly addressed in iteration 8)
- The PDFKit queue has no cap on waiting time across many viewers (iteration 7)
- Encrypted PDFs show one page (iteration 4)

### Strengths (across all iterations)
- Page 1 stays Quick Look's picture byte for byte; a plain GET reads no count; every new path fails closed to the one-page viewer.
- The script is fixed text; the file, page and output go in as arguments, paths as sandbox parameters, never spliced.
- Tests cover the module (a real PDF on a Mac with a page-3-differs control), both routes, and the viewer (arrows, keys, swipe, focus hand-off, debounce, closed viewer, real addresses).
