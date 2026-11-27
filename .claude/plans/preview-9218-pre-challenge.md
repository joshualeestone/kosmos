---
pre_challenge: true
method: challenge-loop
branch: preview-9218
diff_hash: a324e33453a705e9a8363a706aef970eafa9361aa82466d579a7ceb666b7a23f
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T17:01:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind reviewers: sonnet, opus, sonnet; round 3 read the whole branch)
**Converged:** Yes (round 3: no defects; one low residual accepted, below)
**Fixed:** 8 | **Not taken (measured false):** 1 | **Accepted residual:** 1

Validation: Mortals, full suite. Run 1 at b15671548d: 1 red of 31734 (engine/windows-tests-1777 host-branch guard: the
new test skipped on process.platform === 'win32'); fixed at b424946dd8 (skips on /bin/sh missing, which is what it needs).
Run 2 at b424946dd8: 31734 tests, 0 failed, entry clean, hash a324e33453a7, equal to this diff_hash.
Windows: Homer ran it on the Windows box at 5912a6de11 (Windows PowerShell 5.1): page 2 drawn, page 999 refused with
the count, page 1 control.

### Iteration 1 (sonnet)
- [WARNING] mutool past the last page exited 1 "may be damaged" --> FIXED (a2d5583108), then reordered in round 2
- [WARNING] predictable --out staging name --> FIXED (a2d5583108): mkdtemp folder beside --out
- [NIT] a link at --out said "not a plain file" --> FIXED (a2d5583108): says it is a link
- [WARNING] maxBuffer overflow would read as a timeout --> NOT TAKEN: measured on Node 26, err.killed is unset for
  ERR_CHILD_PROCESS_STDIO_MAXBUFFER; the guard I first added could not fire and was removed; a real-subprocess test pins it
- [WARNING] Windows script never run --> MEASURED on the Windows box (above)

### Iteration 2 (opus)
- [BLOCKER] a PDF locked with a password drew blank white pages with exit 0 on a Mac --> FIXED (fa40439917):
  pdfpages answers ERR locked (also stops the board's preview drawing blank later pages); test on a real locked PDF
- [WARNING] mutool may clamp a page past the end and exit 0 --> FIXED (fa40439917): its count is read before drawing
- [WARNING] --out naming the PDF by another case slipped past realpath on APFS and overwrote it --> FIXED: device/inode
- [NIT] an unmakeable temp folder crashed with a stack --> FIXED: one line, exit 1
- Self-generated: the mutool stand-in wrote a file named 'info' into the cwd once the count came first --> FIXED (337fea5e8e)

### Iteration 3 (sonnet, whole branch)
- No defects. Measured: owner-password-only PDFs still draw; user-password ones count null and render false; no caller
  of pdfpages caches a bad state or logs a file name.
- Accepted residual: a locked PDF the board counted BEFORE this change keeps its stored count, so each later-page
  request costs one failed sandboxed osascript run ("could not draw that page").

### Static guards met on the way
- engine/rawwrites-8718 baseline +1 (the private temp copy of the PDF); engine/windows-coupling-audit-1732 inventory
  row for pdfpreview's undefined-safe O_NONBLOCK.
