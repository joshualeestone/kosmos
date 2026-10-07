---
pre_challenge: true
method: challenge-loop
branch: attachfacts-5448
diff_hash: 3ffc2919ad4c881b283f637ce7596018b94f6a94d26ca13684dadbb7c6c1fa6d
validation: passed (Mortals full suite at 8a71853b4, 2026-10-07 02:01 CDT: node 16093 tests, 15861 pass, 0 fail, 0 cancelled, every shell script green; the 17 #5448 tests ran; run_or_skip then skipped on that clean entry for this hash)
subdir_audit: passed
timestamp: 2026-10-07T07:01:43Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes
**Total findings:** 43 (1 BLOCKER, 12 WARNINGs, 3 CONVENTIONs, 27 NITs)
**Fixed:** 15 actionable plus most NITs | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/attachments.js factsOf - a stored png/gif/jpeg/webp type whose bytes are not that format was repeated as fact --> FIXED (6b709532a)
- [WARNING] engine/chat.js, engine/messages.js - trailer comments still said "the attached file's path" only --> FIXED (6b709532a)
- [NIT] header said "in brackets" (parentheses inside the bracket); "size" ambiguous; JPEG stray padding returned null; 1024 KB not 1 MB; Buffer.alloc zero-fill; test comment hedge --> all FIXED (6b709532a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the iteration-1 fix said "unknown type" for a real JPEG whose frame header is past 256 KB)
- [WARNING] factsOf - a genuine image the reader cannot measure was called "unknown type" --> FIXED (152b37241: type by signature, dimensions only when readable)
- [WARNING] headOf - a FIFO open could block the send --> FIXED (152b37241: regular files only)
- [NIT] FF00 outside image data; header wrap; missing edge tests --> FIXED (152b37241)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the iteration-1 padding skip let FF D8 + text + a frame header read as a JPEG)
- [WARNING] imageFacts accepted FF D8 alone while signatureType required FF D8 FF --> FIXED (9994a16e4: one shared signature)
- [CONVENTION] long reflowed comment lines; plan's stale "9 of 9" red count --> FIXED (9994a16e4)
- [NIT] double stat; `_` in media types; loop bound one byte strict --> FIXED (9994a16e4)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] wording implied every uploader type is checked; only the four image formats are --> FIXED (e5082be75: plan and comment narrowed)
- [WARNING] the unreadable-image arm untested --> FIXED (e5082be75: tiny.png test)
- [WARNING] the regular-file guard had no test --> FIXED (e5082be75: FIFO test; measured to hang with the guard removed)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (the FIFO test's win32 skip came from iteration 4)
- [BLOCKER] the new test branches on win32 and was in neither ALSO nor HOST_BRANCH_EXCLUDED, so windows-tests-1777 failed the full suite --> FIXED (1543bdf94: excluded with a reason, verified against the selector source)
- [WARNING] the module's security note said bytes are never parsed here --> FIXED (1543bdf94: names the bounded header read)
- [NIT] SOF length guard; wireNote's sync read cost unstated --> FIXED (1543bdf94)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] a claimed image type was dropped even when the bytes were never read --> FIXED (8a71853b4: only when read)
- [WARNING] signatures too weak (FF D8 FF alone; RIFF WEBP with no chunk) --> FIXED (8a71853b4: an opening marker; a VP8 chunk)
- [WARNING] the header read is synchronous on the send path --> DEFERRED: bounded at 256 KB per image and 10 images per message, stated at wireNote; async would change three server call sites for a local read; reconsider if the data folder can be a network mount (in the plan)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.
- [NIT] stat-then-open window (server-owned folder); per-format magic checks could all route through signatureType; a short read on a network mount loses only dimensions; a non-image type is the uploader's claim (documented)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/attachments.js factsOf | BRANCH | unproven image type repeated | FIXED | 6b709532a |
| 2 | 1 | WARNING | engine/chat.js, messages.js | BRANCH | trailer comments | FIXED | 6b709532a |
| 3 | 2 | WARNING | engine/attachments.js factsOf | SELF | real JPEG called unknown | FIXED | 152b37241 |
| 4 | 2 | WARNING | engine/attachments.js headOf | BRANCH | FIFO open could block | FIXED | 152b37241 |
| 5 | 3 | WARNING | engine/attachments.js imageFacts | SELF | two signature definitions | FIXED | 9994a16e4 |
| 6 | 3 | CONVENTION | engine/attachments.js | SELF | long comment lines | FIXED | 9994a16e4 |
| 7 | 3 | CONVENTION | plan | SELF | stale red count | FIXED | 9994a16e4 |
| 8 | 4 | WARNING | plan, factsOf comment | BRANCH | verification scope overstated | FIXED | e5082be75 |
| 9 | 4 | WARNING | test | BRANCH | unreadable-image arm untested | FIXED | e5082be75 |
| 10 | 4 | WARNING | test | BRANCH | regular-file guard unarmed | FIXED | e5082be75 |
| 11 | 5 | BLOCKER | tools/windows-tests.js | SELF | win32 branch not listed | FIXED | 1543bdf94 |
| 12 | 5 | WARNING | engine/attachments.js header | BRANCH | security note outdated | FIXED | 1543bdf94 |
| 13 | 6 | WARNING | engine/attachments.js factsOf | SELF | dropped unread stored type | FIXED | 8a71853b4 |
| 14 | 6 | WARNING | engine/attachments.js signatureType | BRANCH | weak signatures | FIXED | 8a71853b4 |
| 15 | 6 | WARNING | engine/attachments.js wireNote | BRANCH | synchronous read | DEFERRED | bounded, documented |

### NITs (non-blocking, across all iterations)
- Fixed: header wording, "pixel size", zero-padding skip, 1 MB boundary, allocUnsafe, test comments, FF00, SOF length, `_` in types, single stat, comment wraps
- Not changed: stat-then-open window, routing every magic check through signatureType, network-mount short reads, `image/jpg` not an image kind for previews

### Strengths (across all iterations)
- Fixtures are real encoder output (sips, PIL, cwebp), 13x7 so a swapped width and height fails, with assertions that each fixture is the variant it claims (C0 and C2 JPEG; VP8, VP8L, VP8X)
- Every new test fails on main's attachments.js; the FIFO guard is shown to hang without it
- The uploader's type is held to plain media-type characters, so the terminal line stays one bracket per file
