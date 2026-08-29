---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: repoint-hook-561
diff_hash: 11022207f1fedc044af7c382bab1d225fca125443ad7fb50416a1257f7ca09cb
subdir_audit: passed
timestamp: 2026-08-29T15:22:49Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready; kosmos main unprotected). Bracketed
markers because the template's own heading is refused by this gate, which is my #1458.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING]** This **rewrites entries in a person's `settings.json`**, which the
  module's own header calls worse than a board that scrapes if done carelessly. Bounded
  three ways: only entries carrying **our** marker are touched; an already-correct entry
  is left byte-identical; and a **control test** asserts a foreign hook in the same event
  survives. Perturbing to replace the whole list fails **only** that control.
- **[WARNING]** A person who deliberately re-aimed our hook at their own copy will be
  repointed on the next update. **Accepted deliberately:** the entry carries our marker, so
  it is ours, and the alternative is what shipped, where a machine runs an August script
  forever and the installer reports success. **This is the one behaviour change a reviewer
  should push back on if they disagree.**

### CONVENTIONs

- **[CONVENTION]** Em dash sweep: 0, planted control 1.
- **[CONVENTION]** No closing keyword before #561 or #1467. Neither is finished by this.

### NITs

- **[NIT]** `wantCommand` is computed once outside the loop; it depends only on
  `scriptPath`.

### Attacked and CLEARED

- **Perturbed both ways, each failing the right arm.** Restoring the original skip fails
  the repoint test **and** the control; replacing the whole list fails **only** the
  control. Restores sha-verified.
- **Idempotence asserted**, byte-for-byte, so `setup.sh` re-running on every update does
  not churn a person's file.
- **Verified against the real machine's settings.json** (on a copy), not only fixtures:
  7 stale entries in, 7 correct out, 0 stale remaining.
- **Suite 2921 pass, 0 fail**, exactly three more than main's 2918, all three by name.

### Strengths

- **[STRENGTH]** The defect was found by asking why a self-healing path had not healed
  something, rather than by reading the diff of the thing that broke.
- **[STRENGTH]** The failing behaviour was **success with no change**, which no log line
  and no exit code would ever have surfaced.

### What I am NOT claiming

**I have not run `setup.sh` on this machine**, so I have not observed the live hooks
being repointed end to end. I measured `ensureWired` against a **copy** of the real
settings file. The remaining step is still a deployment, and it still wants an operator.
