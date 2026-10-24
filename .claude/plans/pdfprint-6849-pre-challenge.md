---
pre_challenge: true
method: challenge-loop
branch: pdfprint-6849
diff_hash: be3b3703012c690a77f8f11ea06778ef588b8adbfa0de7afc2111d97b3cc0b63
validation: passed
subdir_audit: passed
timestamp: 2026-10-21T20:10:36Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (1 to 3 before the 13:30 restart, recorded in their commits; 4 to 10 after it, alternating sonnet and opus)
**Converged:** Yes (iteration 10, sonnet: NO NEW ISSUES)
**Total findings iterations 4 to 10:** 13, all fixed (each in its commit below)
**Validation:** full validation passed on this head (node 22936 tests, 22624 pass, 0 fail, 312 skipped; shell 267 of 267)
**Browser-check gates:** none apply (no web/ change)

### Per-Iteration Breakdown

#### Iterations 1 to 3
**Reviewer model:** recorded only in the commit messages
- 1: doctrine 37 with its print and past table; the Mac harness carries the engine (3c65b45331)
- 2: the plan states the detection rule, the cap and measured test counts (82fee4b7f3)
- 3: every matched value is bounded after a measured stack overflow, with a stress test (2317f89b4c)

#### Iteration 4 (sonnet): 4 findings, FIXED (ebf9b8ac66)
- stream bodies were matched as metadata (page text shaped like a date or /ID changed nothing); \s over latin1; the size cap branch; the instruction wording

#### Iteration 5 (opus): 3 findings, FIXED (1c5a4d0d76)
- an indirect /Length read as a shorter direct one; a stream after CR alone; the metadata-stream branch had no real-render fixture

#### Iteration 6 (sonnet): 1 finding, FIXED (4cfb05d601)
- the cap is 64,000,000 bytes, the 64 MB the help says, with a test tying the two

#### Iteration 7 (opus): 2 findings, FIXED (fb6572eed5)
- the Windows instruction regressed main's (Get-FileHash <file>).Hash form; restored

#### Iteration 8 (sonnet): 2 findings, FIXED (0c78372963)
- the built line sent to the next agent names kosmos fingerprint

#### Iteration 9 (opus): 1 finding, FIXED (1f537f62bc)
- outside streams, objects are read as PDF syntax with every string opaque, so a form value shaped like a date is not emptied

#### Iteration 10 (sonnet): NO NEW ISSUES
- three residual shapes recorded in the plan (666b4e1288): none written by a renderer we measured, each gives two fingerprints, never one
