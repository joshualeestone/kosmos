---
method: challenge-loop
branch: range-6805
diff_hash: 5760c2b8838c4eeb1fb14c9b9a889e44f337c111e14132b52051899c41e6f0d9
timestamp: 2026-10-22T03:50:38Z
subdir_audit: passed
iterations: 3
converged: true
---

# Challenge-loop proof: range-6805 (kosmos#6805, a cut attachment download resumes)

The attachment download route answers one byte range (Range: bytes=a-b, a-, -n) with 206 and Content-Range,
an unsatisfiable one with 416 and bytes */size, and anything else (multi-range, another unit, malformed) with the
whole file. Accept-Ranges and a strong ETag (the attachment id plus the file's size and modification time, from
the open descriptor) go on every answer; an If-Range that is not exactly that ETag gets the whole file. The image
preview route is unchanged (no options, no ranges, no ETag). Three blind iterations: 1 Opus, 2 Sonnet, 3 Opus.

#### Iteration 1 (Opus)
- No blocker.
- [WARNING] the ETag was the id alone, safe only while no stored file is ever rewritten: FIXED (id + size + mtime;
  a test rewrites a stored file in place, with a control that the new tag still ranges; red with the id-only tag).
- [WARNING] untested: HEAD with a range past the end, Accept-Ranges on a 416, a ranged request for an unknown id:
  FIXED (three new assertions or tests).
- NITs not changed: lenient whitespace (deliberate, tested); any Range on an empty file is 416 (RFC 9110 allows);
  exact If-Range comparison (fails safe); the file-grew test fakes fstat.

#### Iteration 2 (Sonnet)
- No blocker.
- [WARNING] the changed-file test also changed the size, so it passed with the time part removed: FIXED (a
  same-size rewrite with a later time; red without the time part).
- NITs not changed: a same-length rewrite within one timestamp tick keeps the tag (attachments are written once
  per id); the 416 carries the download headers; If-None-Match is not answered.

#### Iteration 3 (Opus)
- No blocker or warning. Checked the board's own download code (plain download links; the service worker passes
  /api/* through), so nothing in the page changes. NITs applied as comments: the ETag is for resuming only (no
  304); the fstat-faking test must stay sequential. Not changed: lenient whitespace; the same-size test moves the
  time 10 s rather than 1 ms.

#### Evidence
- node --test server.attachment-range-6805.test.js (cwd = worktree): 13 pass, 0 fail.
- 540/540 across the 11 test files that reach the download path (server.test.js, attachment stream, reveal,
  reply-file, inbox, fedmsg, files preview, file browser, links, engine/attachments, this one).
- Mutants, each red: ETag id only; ETag without the time part.
