---
pre_challenge: true
method: challenge-loop
branch: attach-caption
diff_hash: 5c7e3a2b886aaadc963c33e4ee8b02425e0c0fe074f495619dd5f813b6b57426
subdir_audit: passed
timestamp: 2026-08-23T19:13:03Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (bounded before it started)
**Converged:** No
**Total findings:** 11 (2 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 2 NITs)
**Fixed:** 10 | **Deferred:** 1

### Iteration 1
- [BLOCKER] the room post with files and no words sent an empty body (text captured before the substitution) --> FIXED; the room route is now tested with a list
- [BLOCKER] pending files were one list per composer, not keyed by agent or project, so a switch carried April's files under Mikey --> FIXED (keyed like the drafts, repainted on open, cleared for the target sent to; proven in a browser across a switch)
- [WARNING] the ten-file refusal was erased by the next line and the eleventh file was uploaded first --> FIXED (checked before the upload)
- [WARNING] the talk sender cleared chips on a verdict the words did not clear on, and regardless of flightMoved --> FIXED (cleared inside clearSent, for sentName)
- [WARNING] one file per pick and per drop --> FIXED (multiple on both pickers; a loop with the cap)
- [WARNING] the room and project-thread routes were untested with the list --> FIXED (room route case)
- [WARNING] pjWords hides the duplicate only for one file --> DEFERRED to Mona Lisa's multi-file draw (she owns pjAttachmentCard and pjWords; told)
- [CONVENTION] attachUpload's header still described send-on-pick --> FIXED
- [CONVENTION] an unused `text` --> FIXED
- [NIT] the no-words Send pin matched one of two sites --> FIXED (count of two)
- [NIT] the cap counts before de-duplication --> FIXED (documented in the refusal's comment as counting what was asked for)

### Strengths (reviewer's)
- resolveForMessage collapses three owner checks into one that refuses the whole list; keptAttachment keeps checked-is-kept for the list; esc applied to chip text and aria-label; the picker resets so the same file can be attached twice.
