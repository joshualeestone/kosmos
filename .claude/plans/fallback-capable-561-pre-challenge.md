---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: fallback-capable-561
diff_hash: de477d34e67572243a1cbf90828e6b3c008ab18c66083aa6525e21dad9804d46
subdir_audit: passed
timestamp: 2026-08-29T15:09:50Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24, push-as-ready; kosmos main unprotected). That
removed a person, not a test. **Bracketed markers** because the template's own heading is
refused by this gate, which is my #1458, blocked on a book-io org ruleset.

**This corrects a defect I merged two hours ago in #1479.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING]** The probe spawns a subprocess. It runs **only in the two fallback rungs**,
  which a real installed or source layout never reaches, so no properly deployed machine
  pays it on a hot path. Verified: the source-layout arm returns before the probe.
- **[WARNING]** The probe greps for `needs_you` in `report`'s usage output. If that
  usage text is ever reworded, capable CLIs read as incapable and reporting turns OFF.
  **That coupling is pre-existing** (the SessionStart guard has keyed on it since #526) and
  this reuses it deliberately rather than inventing a second, divergent test.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep: 0, planted control 1.
- **[CONVENTION]** No closing keyword before #561 or #1467. Neither is finished by this.

### NITs

- **[NIT]** `speaks_report` is defined inside `resolve_kosmos`. Kept there so the
  `awk` extraction the test uses captures it in one range.

### Attacked and CLEARED

- **Three perturbations, each failing its own arm:** drop either probe, or make the probe
  always-true. Restores sha-verified.
- **Suite 2918 pass, 0 fail**, new arms present by name, 362 PASS lines as a control.

### The finding worth reading, and it is against my own test

**Two controls were VACUOUS and had been since I wrote them this morning.** They set
`PATH` to the fixture directory alone, so **`bash` itself was not findable** and
`resolve` returned empty because it could not execute. They asserted "the resolver
refuses" and were measuring "the shell is missing".

⇒ **Nothing in a green run could show this.** It surfaced only because a perturbation that
should have failed **passed**, and I checked whether the edit had actually applied instead
of accepting the green. The absence under test was "no kosmos", and I had built "no shell".

### Strengths

- **[STRENGTH]** The defect was found by reading my own two-day-old card, which had
  already recorded this exact hazard with the exact path.
- **[STRENGTH]** The first reading (a silence regression) was **wrong and worse than the
  truth**; measuring the SessionStart guard before reporting turned an alarm into an
  accurate, smaller finding.

### What I am NOT claiming

**Card #561 is not finished.** It asks for the installer and `create.js` to lay the hook
down. This does only the "never report silence when it cannot" half of its requirement.
