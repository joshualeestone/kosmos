---
pre_challenge: true
method: challenge-loop
branch: attachtext-6098
diff_hash: 5fd7a5669cc5b8b4cd9e1570cbb69682a339b9656713bf7b8d75278fed2a2136
validation: passed (local full validation via queued-heavy, validation-log hash 5fd7a5669cc5, 2026-10-13 21:09 CDT)
subdir_audit: passed
timestamp: 2026-10-14T02:11:21Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20, alternating opus (odd) and sonnet (even). **Converged:** Yes, iteration 20 returned NO FINDINGS.
Every fix below has a test that went red with the fix reverted (mutant). Details per iteration are in the plan.

### Iteration 1 (opus)
- [BLOCKER] x7: quadratic parsers and an out-of-memory from a 2 KB file. FIXED by a rewrite: conversion in a worker
  thread with memory and time limits; linear forward-only readers; output capped while building.
### Iteration 2 (sonnet)
- [WARNING] x6: a quadratic regex on spaces, ObjStm spans, a sheet part read many times, missing cap notes, a burst of
  uploads run all at once. FIXED (two-slot limiter, rising offsets, read once, notes).
### Iteration 3 (opus)
- [WARNING] x4: "scanned" wrongly said at the text cap, ASCII85/ASCIIHex filter chains, WinAnsi punctuation, a
  backtracking date check. FIXED; PDFKit counted in the limiter.
### Iteration 4 (sonnet)
- [WARNING] MacRoman and /Differences fonts read as WinAnsi; ASCII85 not bounded; [Red] read as a date. FIXED.
### Iteration 5 (opus)
- [WARNING] mapless CJK (Type0/Identity) read as garbage; encrypted permission-only PDFs not offered to PDFKit. FIXED.
### Iteration 6 (sonnet)
- [WARNING] an unused mapless font blanked every page off a Mac. FIXED: fonts judged only when drawn with.
- [NIT] no test for PDFKit's locked answer. FIXED.
### Iteration 7 (opus)
- [WARNING] glyph-at-a-time PDFs (Chrome, Ghostscript) read letter by letter. FIXED: spacing from measured widths.
- [WARNING] symbolic fonts with no /Encoding trusted as WinAnsi. FIXED.
- [NIT] notes hid each other. FIXED.
### Iteration 8 (sonnet)
- [WARNING] fonts with no /Widths glued words. FIXED. [WARNING] Type0 /W budget per font only. FIXED (document budget).
### Iteration 9 (opus)
- [WARNING] style-change text blocks and Td-placed cells; inline images swallowing text; Kangxi radicals. FIXED.
### Iteration 10 (sonnet)
- [WARNING] right-to-left text in visual order. FIXED (PDFKit on a Mac, a note elsewhere). [NIT] x2 FIXED.
### Iteration 11 (opus)
- [WARNING] parts over 20 MB read as nothing; percentages and currency silently unformatted. FIXED.
- [NIT] doubled cap note; ligatures. FIXED.
### Iteration 12 (sonnet)
- [WARNING] a table cut at the part limit dropped whole; locale tags read as currency. FIXED.
### Iteration 13 (opus)
- [WARNING] the cut fix undone inside an unclosed mc:Fallback; [$-x-sysdate] read as currency. FIXED.
### Iteration 14 (sonnet)
- [WARNING] a self-closed mc:Fallback dropped the rest of the document (orgchartfile stripBlocks). FIXED.
### Iteration 15 (opus)
- [WARNING] uncalculated formulas shown as blanks with a false note. FIXED. [NIT] x2 FIXED.
### Iteration 16 (sonnet)
- [WARNING] an Excel formula returning "" called uncalculated. FIXED. [NIT] x2 FIXED.
### Iteration 17 (opus)
- [WARNING] tracked changes read as a clean document; prefixed SpreadsheetML read as empty. FIXED.
- [NIT] non-breaking hyphens and positioned tabs. FIXED.
### Iteration 18 (sonnet)
- [WARNING] tab-stop definitions read as tabs (an iteration 17 regression). FIXED. [NIT] x2 FIXED.
### Iteration 19 (opus)
- [WARNING] /Contents naming an array object read as scanned off a Mac. FIXED. [NIT] plan line FIXED.
### Iteration 20 (sonnet)
NO FINDINGS.

## Tests
engine/attachtext-6098.test.js: 70. Neighbours and meta (attach, orgchartfile, engine.reachable, fixture-discipline,
1732): green at each iteration. Real files: more than 110 local PDFs compared old against new at iterations 7 to 10.
