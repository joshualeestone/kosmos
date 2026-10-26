---
pre_challenge: true
method: challenge-loop
branch: hashkind-7213
diff_hash: 7923ee379ad360888b43ad9c99ba13a98e9819f140c0ace1b19cd4d6318fdfb9
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T21:11:11Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (alternating sonnet and opus)
**Converged:** Yes (iteration 5, sonnet: no BLOCKER or WARNING)
**Total findings:** 0 BLOCKERs, 9 WARNINGs, 15 NITs
**Fixed:** every WARNING | **Deferred:** 1 (the working-rules sentence, with its reason in the plan) | **Accepted with a reason:** the rest
**Validation:** full validation PASSED on this head 2b1ebce61c (hash 7923ee379ad3): node suite 24288 tests (0 fail), test:shell 4 shards all green, type-check, lint, build. Before it: validation 1 (Mortals) failed comment-deferral.test.js (#147) on "a mark sent between #6849 and #7213", reworded in 2b1ebce61c; validation 2 died with Mortals' network (13:28, never ran); validation 3 failed only engine/backuprestore.test.js:260, a pre-existing timing flake on branches that do not touch it (filed #7235, now Renet's).
**Browser-check gates:** none apply (no web/ change)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet. **New findings:** 2 WARNINGs, 3 NITs. **Self-generated:** 0
- [W] older marks (a normalized hash under sha256:) read as changed through the new compare --> FIXED e2c9d47f32 (fallback to the PDF fingerprint)
- [W] a PDF already emptied of dates matched by hex but refused by label --> FIXED (the hex decides)
- NITs: orphaned handoff comment, inverted assertion messages --> FIXED; fixture drift already controlled

#### Iteration 2
**Reviewer model:** opus. **New findings:** 2 WARNINGs, 3 NITs. **Self-generated:** 2 (iteration 1's fallback and message)
- [W] the fallback also ran for a bare shasum value, so a byte-for-byte check could pass for different bytes --> FIXED 419aa3271a (needs the sha256: label)
- [W] the "has none" message was false for a PDF over 64 MB or with nothing to leave out --> FIXED (each gets its own reason)
- NITs: a text file matched a pdf-normalized value by hex (FIXED); stale descriptions (FIXED); the working-rules sentence (DEFERRED with reason)

#### Iteration 3
**Reviewer model:** sonnet. **New findings:** 1 WARNING, 3 NITs. **Self-generated:** 1
- [W] a hand-typed sha256:<shasum> cannot be told from an older mark, so a fallback match read as a byte match --> FIXED eab7924f62 (the words say the bytes differ and how to check byte for byte)
- NITs: success words for a PDF with nothing left out (FIXED); a re-open race affects only reason text (accepted); task built --file usage (FIXED)

#### Iteration 4
**Reviewer model:** opus. **New findings:** 1 WARNING, 1 NIT. **Self-generated:** 1
- [W] a PDF fingerprint pasted without its label read only "differs" on an unchanged PDF --> FIXED e994a8e1b4 (still differs, and says what the value is)
- [N] exit 1 means both "differs" and "install incomplete" --> accepted (pre-existing install exit; the words say which)

#### Iteration 5
**Reviewer model:** sonnet. **New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs. **Self-generated:** 0 --> CONVERGED
- [N] "nothing in it was left out" for a PDF over 64 MB --> accepted (true). [N] an older CLI given the notice's two-argument form --> accepted (CLI and board ship together). [N] working rules --> already deferred.

### Mutations (each went red, restored green)
PDF label back to sha256:, compare ignoring kind, Mac CLI passing only $1, legacy fallback removed, label-only compare, bare-value fallback, PDF-only hex match, size reason, unlabelled-fingerprint hint.
