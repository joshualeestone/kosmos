---
pre_challenge: true
method: challenge-loop
branch: nkmanifest-5535
diff_hash: 199ace3685a9e3b341c4718221bc27d4873a1e475a1e98b57b36a998d65eec7e
validation: passed (Mortals full suite at 460c6b347, 19232 tests, 18989 pass, 0 fail, 0 cancelled, 2026-10-11 19:32 CDT; local helper skipped on that clean entry, hash 199ace3685a9)
subdir_audit: passed
timestamp: 2026-10-12T00:33:31Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews: Sonnet, Opus.
**Converged:** Yes, at iteration 2 (Opus): NITs only, all taken. It checked adversarially that a malicious store or device gains nothing from the carried key.
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet (blind, on b89a8dada; NOT CONVERGED)
- Checked and held: forged-chunk resistance (key and id both come from the signed manifest), no wrong or chosen key on
  any restore path, no Mac names new chunks from a carried key, readers unchanged (member secret key holders, as KBN1),
  the size budget (about 270 bytes of fixed fields), no caller of restoreSnapshot outside tests.
- FIXED (WARNING): "canonical base64" was not enforced: a last character with a non-zero padding bit decoded to the
  same key and passed. The decoded bytes must now encode back to the very string. Test case (the padding bit flipped);
  mutant red.
- FIXED (CONVENTION): manifestNamingKey had landed between restoreSnapshot's doc block and the function, and the new
  result lines lacked the " * " prefix. Moved above the block; prefixed.
- FIXED (NIT): backupkeys.js header points at the manifest-carried key. FIXED (NIT): the 1024 comment names ~270.

#### Iteration 2
**Reviewer model:** opus (blind, on 9d11d22d8; CONVERGED, NITs only)
- Checked adversarially and held: a malicious store learns nothing new (the key is inside the sealed manifest; names
  still come only from the signed manifest); a malicious device gains nothing it could not already cause; a reviewer
  who can open manifests already holds memberSk, so testing guesses adds nothing. No vacuous test found.
- FIXED (NIT): backupkeys.js named the wrong paragraph and still said restore "passes" the id; it checks it now.
- FIXED (NIT): openManifest now warns that the opened manifest holds a secret (namingKey) for the content view (#5686)
  and restore (#5536): pick fields, never pass the object on, log it or return it whole.
- FIXED (NIT): restore's doc says malformed 'namingKey' can mean the CALLER's key is wrong.
