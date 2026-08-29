---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: codexsand-1500
diff_hash: aee18a0b7c6331d24ddde38f8973a1953b496515bdf0f43bf07a9f546a673379
subdir_audit: passed
timestamp: 2026-08-29T19:39:01Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. **Card filed
by me this afternoon while running somebody else's discriminator.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] I RESTRUCTURED A FUNCTION IN THE MOST SENSITIVE MODULE IN THE
  ENGINE.** `configRoots` is what decides whose machine gets read. The extraction
  is mechanical (the predicate body moved out verbatim, one indent level), but
  **`status.js` is 4000+ lines and 141 of its own tests plus the whole suite are
  the only thing standing behind that claim.**
- **[WARNING] IT ONLY COVERS `found()`.** A caller reaching `codexsession`
  directly is still unsandboxed. Today `discover.js` is the only such caller
  outside the module itself, **and I checked that rather than assuming it**, but
  the next one will not inherit this.
- **[WARNING] THE REAL FIX FOR THE CLASS IS NOT THIS.** Every future reader of the
  operator's machine has to remember to call the predicate. **A guard you must
  remember is the same shape as the one that just failed**, and I do not have a
  better answer than "make it reachable and say so loudly".

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword; a person should read the before/after.

### NITs

- **[NIT]** `sandboxIsInconsistent` recomputes its temp roots on every call. It is
  called once per `found()` and once per `configRoots()`; caching would be a
  second place for the resolution rules to be right.

### Attacked and CLEARED

- **BEFORE AND AFTER ON THE REAL FIXTURE, NOT AN ARGUMENT.** Before: a real agent
  out of another agent's scratchpad and this Mac's `unreadable: 8`. After: only
  my fixture's agent and `unreadable: 1`.
- **PERTURBED FIVE ARMS**, each failing its own test, including **"the guard runs
  AFTER the read"**, which is the version that would look correct in review and
  still open the operator's rollouts.
- **⭐ A CONTROL FAILED AND THE CODE WAS RIGHT.** My consistent-sandbox arm set
  `AGENT_WORKFORCE_HOME`; `status.js`'s `homeDir()` is a bare `os.homedir()` and
  does not read it, **unlike `accounts.js`, `runningas.js` and four others which
  do.** ⇒ **Without that red I would have shipped an arm that could never have
  passed**, which is a control that proves nothing while looking like rigour.
- **THE PRODUCTION ARM IS ITS OWN TEST.** If this predicate could fire for a real
  user, Kosmos would find nobody's agents at all. That is the direction that
  matters and it is asserted separately from the fixture arm.
- **Suite 2980 pass, 0 fail.**

### The part worth remembering past this card

**The suite was green throughout and still is.** This was never a failing test. It
was every discover assertion quietly reading whoever ran it, **and a green suite
is exactly what that looks like.**
