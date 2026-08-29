---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: lazyroot-1443
diff_hash: 041fb986bab0ee7d0c616063cc9ef1625681a22070fd1ffe4cd6e1283b378b46
subdir_audit: passed
timestamp: 2026-08-29T20:05:04Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. **Card I
filed myself, with a suggested shape I have followed.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] I CHANGED HOW 94 REFERENCES ACROSS 39 FILES RESOLVE.** They now hit
  a getter instead of a frozen string. The suite is the only thing behind that
  claim, and it is 2993 green. **The shape I did NOT check is anything that
  captures `store.ROOT` into its own module-level constant**: that would re-freeze
  it at ITS require time, one layer out, and nothing here would notice.
- **[WARNING] A GETTER IS SLOWER THAN A CONSTANT.** `ROOT` is read inside
  `avatarPath` in a loop over a directory listing. It is a `path.join` of two
  strings and a `process.env` read, so it is not measurable at this scale, but it
  is a real change from free to not-free.
- **[WARNING] EMPTYING THE ALLOWLIST MAKES THE CHECKER STRICTER FOR EVERYBODY.**
  Any new module-level root anywhere in the tree now fails it with no named
  exception to fall into. **That is the intent**, and somebody adding a
  legitimate one will meet a check with nowhere to put it and will have to make
  a case rather than add a line.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword.

### NITs

- **[NIT]** `avatarsDir()` and `profilesDir()` are named differently from the
  constants they replace (`AVATARS`, `PROFILES`), because the exported names had
  to stay. Two spellings for one path.

### Attacked and CLEARED

- **PERTURBED FOUR ARMS**, each failing its own test. Restores sha-verified.
  **The memoise arm is the one worth having: a one-shot cache passes every
  "does a late sandbox work" assertion and still freezes on first read**, which
  is the same defect with a slower fuse.
- **⭐ SEVEN TESTS WENT RED WHILE THE FIX LOOKED COMPLETE.**
  `ReferenceError: AVATARS is not defined`. **I replaced the internal uses I found
  by grep and did not prove I had found them all**; two more sat at lines 119 and
  201. The closing check strips comments and asserts **exactly one** bare-constant
  line remains.
- **THE ALLOWLIST REMOVAL IS CONTROLLED IN BOTH DIRECTIONS**: with the list empty
  the checker exits **0** on the tree and **1** on a planted
  `const FROZEN2 = os.homedir()`, naming it. **Without that arm, emptying the list
  would look like a fix and could equally be a checker that stopped looking.**
- **THE EXPORTS ARE ASSERTED ENUMERABLE**, because a non-enumerable getter is a
  silent behaviour change in anything that spreads the module.
- **Suite 2993 pass, 0 fail.**

### One measurement error I made and caught

I read the checker's exit code through `| tail -6` and got **0** on a run that
had found something. **That is `tail`'s status.** Re-measured without the pipe:
**1** on a finding, **0** clean. Same family as the `grep -q` finding I wrote up
an hour ago, in my own hands, in the middle of verifying something else.
