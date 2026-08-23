---
pre_challenge: true
method: challenge-loop
branch: attach
diff_hash: d80d7f5795db32b844d97cbea5b3d5822caeea221bf6b9ceaf97cf2fcbf18420
subdir_audit: passed
timestamp: 2026-08-23T18:02:57Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No (bounded at one round before it started; the reviewer was briefed on path safety, serving, the subprocess, ownership and the wire)
**Total findings:** 13 (2 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 13 | **Deferred:** 0

### Iteration 1
- [BLOCKER] the file's path was concatenated onto the text BEFORE deliver's checks: the 2000-char cap was measured against text plus path, and cleanMessage collapsed double spaces in a file name into a path that does not exist --> FIXED (a `trailer` parameter on deliver, appended after the checks; control characters in it refused in words; tests at 1990 chars and with "Q3  report.txt")
- [BLOCKER] a file named record.json overwrote the metadata and was then served as it --> FIXED (record.json and preview.png reserved; test)
- [WARNING] execFileSync blocked the event loop for up to 10 s --> FIXED (execFile, awaited)
- [WARNING] the image preview served the uploader's content-type (a .png uploaded as text/html drew as HTML) --> FIXED (type from the IMAGE set by extension; test)
- [WARNING] two requests rendering one fresh PDF could cache a half-written PNG --> FIXED (temp folder, rename into place, per-file promise lock)
- [WARNING] the over-cap test proved only a non-200 --> FIXED (folder entry count before and after)
- [WARNING] the wrong-owner test hit a 404 before the ownership check --> FIXED (a real project the agent is on, both directions)
- [WARNING] control characters in a name passed the upload and were refused at the pane --> FIXED (stripped in safeName; test)
- [WARNING] safeKey's throw for a project id with no key characters --> noted; project ids are minted by projects.create and always have key characters; the route wraps the lookup in words now
- [CONVENTION] kind 'text' includes .html and the preview is its raw text --> FIXED (the record comment says it is untrusted text, never markup; told Mona Lisa)
- [NIT] projects.readAll outside the promise --> FIXED (wrapped)
- [NIT] slice could halve a surrogate pair --> FIXED (Array.from; test)
- [NIT] a test computed its expectation with the code's own transform --> FIXED (literal)

### Strengths (reviewer's)
- Ids are 24 hex and read walks only the two scope folders; content-disposition uses filename* with encodeURIComponent; SVG is never an image; the renderer seam keeps unit tests off Quick Look; the stored row keeps the attachment by its known keys with preview present-and-null.
