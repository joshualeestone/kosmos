---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: wpboot-1494
diff_hash: 0243e5c6ab362873906ddbfe204c5bea1dfe205242f8eb544d9b98b6cde241f2
subdir_audit: passed
timestamp: 2026-08-29T21:11:41Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458.
**Follow-up to #1518, prompted by the ambiguity biting within the hour.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] IT WRITES ONE LINE ON THE FIRST BOARD READ AFTER EVERY RESTART.**
  On a board that restarts often, the log is mostly boot lines. **That is the
  intended trade** (a boot line is the thing that makes an empty log readable),
  and it is still growth nothing prunes.
- **[WARNING] IT DOES NOT PROVE THE CODE IS CURRENT, ONLY THAT SOME VERSION
  RAN.** A boot line from a board carrying an older `wouldping.js` looks
  identical. **The version is not in the line and I have not put it there**,
  because the module does not have a version to state.
- **[WARNING] I DID NOT PERTURB THE NOTE TEXT.** The anchor did not match and I
  left it rather than fake the arm. The three arms that matter all fire.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword.

### NITs

- **[NIT]** `announced` is process state that `reset()` clears, so a test can
  simulate a restart. That is a third piece of module state after `last` and
  `bootAt`.

### Attacked and CLEARED

- **PERTURBED THREE ARMS**, each failing its own test: no boot line, announce
  after the key check, announce on every call.
- **⭐ THE ORDERING ARM IS THE ONE WORTH HAVING.** `announce()` sits BEFORE the
  key check, so **a board whose every card lacks a name still records that it
  ran.** That is precisely the population somebody would read as "not deployed",
  and moving the call one line later fails its own test.
- **A TEST STATES THE THREE READER-FACING STATES IN THE ORDER A READER ASKS
  THEM**, rather than asserting about a field. **The property is the question,
  not the implementation.**
- **Suite 3012 pass, 0 fail.**

### The event that made this necessary, recorded because it is the argument

**#1518 merged, the board restarted, and the code was not served.** The shared
checkout was two commits behind and Angel correctly declined to pull it. **For
twenty minutes an absent directory meant "the code is not there" and was
indistinguishable from "the scrape never fires".** It was readable only because
three people watched it happen.
