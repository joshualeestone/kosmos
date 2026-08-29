---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: winfloor-570
diff_hash: c3a2e7082dfaebb8a366f71d6f3525610ef4f414cacc7511bc8cebb987b521fd
subdir_audit: passed
timestamp: 2026-08-29T20:21:17Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. **This
guard exists because Renet reported his own defect rather than quietly fixing
it.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THE EQUALITY IS STRICTER THAN THE PRODUCT NEEDS**, deliberately.
  If somebody ever has a legitimate reason to stage a SUBSET of `engine/`, this
  fails and they must change it consciously. **That is the intent and it is a
  real cost**: the check encodes "ship all of them" as a rule nobody has actually
  ruled on.
- **[WARNING] `refuse()` DELETES A FILE.** It only ever removes `$ZIPOUT`, which
  this script created seconds earlier, and only on a path that is already
  failing. **But it is an `rm` in a build script and it is worth seeing.**
- **[WARNING] THE GUARD RUNS AFTER THE ZIP IS BUILT**, so a bad build still costs
  the full 35 MB of work before refusing. Staging-time checks would be cheaper
  and would not see the artifact, **which is the thing being asserted about.**

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword.

### NITs

- **[NIT]** `_repomods` shells out to `ls | grep -vc` on every build. Trivial,
  and it is the same list the staging loop already walked.

### Attacked and CLEARED

- **PLANTED HIS EXACT DEFECT AND WATCHED IT FIRE**: dropping the filter exits 1
  with **"the zip ships 78 test file(s)"**. **78 is his number**, which is the
  strongest evidence available that the guard covers the thing it was written
  for.
- **PERTURBED FOUR ARMS**, including **"swap equality for a floor"**, which is
  the defect class rather than the instance.
- **⭐ MY CRLF TEST WENT RED ON A CORRECT BUILDER** because it scanned every
  `printf` in the file, including the new guard's plumbing. **The fix was to the
  TEST**: the artifact's bytes were independently verified CRLF by me and by
  Renet, so the product was never in question. **Population error, third time
  today**, and the narrowed scan now reads only the blocks that write shipped
  files.
- **THE REFUSAL CLEANUP IS CONTROLLED BOTH WAYS**: a refused build leaves no zip
  and no checksum; a clean build still produces both.
- **Suite 2997 pass, 0 fail.**

### The reusable half

**A floor cannot detect a defect that inflates the count it measures.** His
"at least 50" was satisfied by the very files that should not have been there.
**Equality can. Zero can. A floor cannot.**
