---
pre_challenge: true
method: challenge-loop
branch: filedl-7952
diff_hash: 6c5c6253471e24f78287f100bdb3e8fa445c8b77374d63900cd07c09b843e76e
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T18:54:02Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round cap, the standing usage rule: stop at 8 unless a BLOCKER is open; none was)
**Total findings:** 17 actionable (0 BLOCKERs, 15 WARNINGs, 2 CONVENTIONs), plus NITs
**Fixed:** 15 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (blind security review Splinter asked for: can any other page get a request marked same-origin)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift - nothing could fail if the frame guard went --> FIXED (live frame row, source pin; 57eccd2909)
- [WARNING] native-app/main.swift - a busy (429) folder answer after the Allow question was silent --> FIXED (57eccd2909)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, several NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift - a page commit between Allow and the start still started the download --> FIXED (8303a929cb)
- [WARNING] web/index.html - the download button was 32 px at phone width --> FIXED (44 px; 8303a929cb)
- [WARNING] docs/browser-checks/render-file-dlbutton-7952.js - no phone or keyboard arm --> FIXED (8303a929cb)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, several NITs
**Self-generated:** 2 of the above (the folder refusal rule and the optional source frame came from earlier fixes)
- [WARNING] native-app/main.swift - a 403 the page's look could not see went unsaid --> FIXED (401/403 said by the app; d829a1d998)
- [WARNING] native-app/main.swift - the busy sentence would show twice --> FIXED (folder refusals the app's again, as on main; d829a1d998)
- [WARNING] native-app/main.swift - the optional source frame was dead code --> FIXED (short-circuit on isMainFrame; d829a1d998)
- [WARNING] native-app/main.swift - the start-void rule had no selftest row --> FIXED (live arm; d829a1d998)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] native-app/main.swift - the app-started path ran on this computer's own board too --> FIXED (Kosmos+ pages only; 6a3c26da92)
- [WARNING] native-app/main.swift - a 401/403 could be said twice --> FIXED (only for downloads the app started; a double when both are refused accepted; 6a3c26da92)
- [WARNING] native-app/main.swift - the busy sentence for any 429 --> FIXED (folder route only; 6a3c26da92)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, several NITs
**Self-generated:** 2 of the above
- [WARNING] native-app/main.swift - the selftest switch on for the whole run left the local path covered by one arm --> FIXED (7d7bf12ff3)
- [CONVENTION] native-app/main.swift - isFolderDownload between pageSaysDownloadRefusal and its doc comment --> FIXED (7d7bf12ff3)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, several NITs
**Self-generated:** 1 of the above (iteration 5 moved the frames arm off the marked path)
- [WARNING] native-app/main.swift - the frame row could not fail on isMainFrame --> FIXED (frames arm marked again; 97158220c3)
- [WARNING] native-app/main.swift - the 403, web-page and busy branches had no live row --> FIXED (three arms, each red under mutation; 97158220c3)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, several NITs
**Self-generated:** 1 of the above
- [WARNING] native-app/main.swift - no marked arm ran through the Allow question --> FIXED (askArm marked; 1a41134539)
- [WARNING] native-app/main.swift - the refused arm was not on a Files route, so the branch order was unpinned --> FIXED (red under the order mutation; 1a41134539)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, several NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift - sourceFrame read without a nil guard --> DEFERRED: it is an Objective-C object bridged non-optional, so a nil is not unwrapped and does not trap; a nil frame answers isMainFrame false, and the short-circuit never reads its origin, so it fails closed. Iteration 3 found the optional wrapper this asks for to be dead code. Not measured with a real nil frame.
- comment NITs (stale "clicked LAST", the mode count wording) --> FIXED (578b4f9b52)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | native-app/main.swift | BRANCH | frame guard unpinned | FIXED | 57eccd2909 |
| 2 | 1 | WARNING | native-app/main.swift | BRANCH | busy folder after Allow silent | FIXED | 57eccd2909, d829a1d998 |
| 3 | 2 | WARNING | native-app/main.swift | BRANCH | commit before start | FIXED | 8303a929cb |
| 4 | 2 | WARNING | web/index.html | BRANCH | 32 px on a phone | FIXED | 8303a929cb |
| 5 | 2 | WARNING | render-file-dlbutton-7952.js | BRANCH | no phone/keyboard arm | FIXED | 8303a929cb |
| 6 | 3 | WARNING | native-app/main.swift | SELF | 403 unsaid | FIXED | d829a1d998 |
| 7 | 3 | WARNING | native-app/main.swift | SELF | busy said twice | FIXED | d829a1d998 |
| 8 | 3 | WARNING | native-app/main.swift | BRANCH | dead optional | FIXED | d829a1d998 |
| 9 | 3 | WARNING | native-app/main.swift | BRANCH | start-void unrowed | FIXED | d829a1d998 |
| 10 | 4 | WARNING | native-app/main.swift | BRANCH | own board on the new path | FIXED | 6a3c26da92 |
| 11 | 4 | WARNING | native-app/main.swift | SELF | 401/403 twice | FIXED | 6a3c26da92 |
| 12 | 4 | WARNING | native-app/main.swift | BRANCH | busy for any 429 | FIXED | 6a3c26da92 |
| 13 | 5 | WARNING | native-app/main.swift | SELF | switch on for the whole run | FIXED | 7d7bf12ff3 |
| 14 | 5 | CONVENTION | native-app/main.swift | SELF | doc comment orphaned | FIXED | 7d7bf12ff3 |
| 15 | 6 | WARNING | native-app/main.swift | SELF | frame row unfailable | FIXED | 97158220c3 |
| 16 | 6 | WARNING | native-app/main.swift | BRANCH | three branches unrowed | FIXED | 97158220c3 |
| 17 | 7 | WARNING | native-app/main.swift | BRANCH | marked path not through the question; order unpinned | FIXED | 1a41134539 |
| 18 | 8 | WARNING | native-app/main.swift | BRANCH | sourceFrame nil | DEFERRED | fails closed; see iteration 8 |
| 19 | 5 | CONVENTION | web/index.html | BRANCH | the button branch also on the narrow panel's list | DEFERRED | shared handler, harmless: no button is drawn there |

### NITs (non-blocking, across all iterations)
- The browser check's "opens no preview" reads the absence of a preview request, not the overlay (iterations 5, 7).
- Source pins count call sites (fragile to a rename by design).
- Review-round labels in comments (this codebase's convention, kept).

### Strengths (across all iterations)
- The mark needs a Kosmos+ page, a board page, a same-origin target, the source frame being the main frame at the page's origin, and the person's Allow; it grants nothing the page could not already fetch.
- Every new guard has a live row that goes red under its mutation (header not set, page check forced, frame check dropped, start check removed, 403 branch removed or moved, startedHere removed, switch removed).
- Every WebKit decision is answered exactly once on every path; destination, quarantine and Dock go through the one delegate.
