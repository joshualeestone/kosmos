---
pre_challenge: true
method: challenge-loop
branch: staleapp-7203
diff_hash: f020ec9390342511ec3543a13d7c492cf5fa36c5c2d77c0213fda7db7ae48d7d
validation: focused-passed; full-suite 4 unrelated red, see below
subdir_audit: passed
timestamp: 2026-10-26T17:07:34Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, both accepted in the plan)
**Fixed:** every WARNING raised in iterations 1-3 and the iteration 4 NITs | **Deferred:** 0 | **Asked:** 0

Validation (6j), stated as it happened:
- Focused, on the rebased head (base b085909327): install.sharedicon-5913.test.js 20 tests, 20 pass, 0 fail, rc 0.
- Full local suite, once, at convergence (before the rebase, 11:0x-11:51 CDT): 24281 tests, 4 failed, EXIT=1. The four
  are bridges.board-proof-1765 ("agy report never attempted the report") and three in cli.refused-retry-6968 (request
  counts 1 vs 2). Neither file touches the installer; alone on the same branch both pass (29/29), and
  cli.refused-retry-6968 passed three more times alone under load ~19. The run overlapped load ~18-23 and an
  out-of-queue full suite (m424). A second full run was queued and withdrawn at 12:03 with the queue 9 deep; PR CI
  carries the full suite. Not recorded as a local pass.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the helpers sat between sealed_icon_reusable's header and the function, and the header still said the
  version does not gate reuse --> FIXED (header states the #7203 rule)
- [WARNING] a refused reuse left this account's reuse marker, so the owner's uninstall kept an icon nobody here opens
  --> FIXED (the marker is taken back)
- [WARNING] the refusal test did not assert where this account's own icon goes --> FIXED (asserts home Applications)

#### Iteration 2
- [WARNING] the marker take-back had no test --> FIXED (own marker goes, another account's stays, a held reuse keeps it)
- [WARNING] the take-back comment named only the older-icon path --> FIXED

#### Iteration 3
- [WARNING] the marker was taken back in resolve_app_dir before this account had its own icon; a skipped or failed
  icon step would leave it on the shared icon without its marker --> FIXED (own_icon_placed, only after APP_MADE=yes;
  wiring pinned)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
- [NIT] own_icon_placed sat under the #5913 doc block --> FIXED (moved)
- [NIT] no case for a pre-release shared version or an unreadable own version --> FIXED (both pinned; red with the
  own-version gate removed, 19 pass 1 fail)
- [NIT] plutil -extract raw on older macOS --> recorded: the installer floor is 13.5; fails closed (an extra icon)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (whitelist admits "1..2"; the two-icon trade),
both recorded as accepted in the plan.
**Converged**: no new actionable findings.

### Weakest premise
That the 0.7.61 window came from another account's sealed app (the #5913 reuse path). Not reproduced on a real second
macOS user; reasoned from the code and the card.
