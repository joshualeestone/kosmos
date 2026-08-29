---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: dropsplit-1493
diff_hash: a2db8ba5c4d8979acdaff82bbd6119e556d5415a531746a5fbab11dd572f52fd
subdir_audit: passed
timestamp: 2026-08-29T20:34:58Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. **Claimed
on the card and with Splinter before starting; Renet is on the installer row and
I am not touching it.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THE RATIO IS FROM ONE MACHINE, AND IT IS THE WRONG MACHINE.**
  13 of 17 gone is measured on a developer box with two years of deleted worker
  folders. **A fresh install has no deleted agents at all**, so her split will
  very likely be the other way round. **The split is still worth having; the
  RATIO is not a fact about users.**
- **[WARNING] IT ADDS AN `fs.statSync` PER DROPPED FOLDER.** On this machine that
  is 17 extra stats on a route whose own comment already calls itself expensive.
  Negligible here; **it scales with the number of folders that FAIL, which is the
  population that grows on a neglected machine.**
- **[WARNING] "GONE" AND "UNREADABLE" ARE NOT DISTINGUISHED.** A directory that
  exists but cannot be `stat`ed (permissions, a dead mount) counts as GONE. **That
  is the wrong bucket for it** and I have not seen a real instance, so I have not
  built a third.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword: the render half and her file both remain.

### NITs

- **[NIT]** Three keys now start with `noInstructions`, which is a long prefix to
  read three times. The alternative was a nested object, and that would change
  the shape of an existing key.

### Attacked and CLEARED

- **PERTURBED FOUR ARMS**, each failing its own test. Restores sha-verified.
- **⭐ AND THE SUM TEST PROVEN TO FAIL ON ITS OWN**, by putting one folder into
  BOTH halves. Without that, an invariant that only ever fires alongside another
  test is not evidence that it works.
- **THE SUM TEST ALSO ASSERTS BOTH HALVES ARE NON-EMPTY**, or it would hold for a
  reason that has nothing to do with the split.
- **THE EXISTENCE CHECK IS ITS OWN `try`**, so it can never be the reason a folder
  stops being counted at all. **A drop that vanished while we were describing
  drops would be this card's own defect.**
- **CROSS-CHECKED BY TWO INSTRUMENTS WRITTEN SEPARATELY.** A standalone probe:
  13 gone, 4 present. The engine: 13 gone, 4 present.
- **Suite 2999 pass, 0 fail.**

### What this is for

**Her forensics file.** All four drop buckets are counted and named, and the
largest is now split by the only axis that changes what anybody would do about
it. **When it lands, the answer should be readable without opening a byte.**
