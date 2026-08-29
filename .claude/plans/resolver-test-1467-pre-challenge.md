---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: resolver-test-1467
diff_hash: e072287165f9f9cee90f99fc86d1f1cacb3e8f094994d23b5f7e01c274a55c9d
subdir_audit: passed
timestamp: 2026-08-29T14:28:38Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent.** Josh ruled at 09:24 that he will not review PRs and finished
work should be pushed as ready; kosmos main is unprotected. **That removed a PERSON from
the loop, not a test**, so every gate I build for myself still applies and is below.

⚠️ **Bracketed markers used deliberately.** The template still tells authors to write
`### BLOCKERs` headings, which this gate refuses; that is my own #1458, whose PR is
blocked on a book-io org ruleset. **This proof works around a defect I filed.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING]** `tools/test-report-hook-resolver.sh` pins the **deployed-elsewhere arm to
  return EMPTY**, which is the behaviour that broke reporting for 18 agents. That is
  deliberate documentation of current behaviour, **not endorsement**, and anybody fixing
  #1467 properly **must change this test as part of the fix**. Its failure message says so.
  If that reads as obstruction rather than a tripwire, it is the wrong shape.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep on the diff: 0, against a planted control returning 1.

### NITs

- **[NIT]** The arms build real directory layouts rather than mocking, which is slower than
  a stub. Deliberate: **the bug IS a path relationship**, and a mock of the filesystem
  would have been a mock of the defect.

### Attacked and CLEARED

- **Perturbed three rungs**, each failing its own assertion, restore verified by sha.
  Dropping rung 2's `server.js` guard turns the **CONTROL** red, which is what proves that
  control load-bearing rather than decorative.
- **The test is actually executed.** `tools.every-test-runs.test.js` caught it unwired and
  named the fix; wired into `test:shell`, guard now 3 pass. **Confirmed present by name in
  a full-suite run**, not merely in a direct invocation.
- **#1472 does not bite here.** Local `main` is **0 commits behind** `origin/main` in this
  repo, so the `diff_hash` covers my change and nothing else. That defect is
  repo-dependent, and `claude-setup` at 1,875 behind was the bad case.

### Two defects the perturbation found in my own work

- **A control keyed on a rung's content**, so removing that rung made it report an
  extraction failure that had not happened. Re-keyed to structure.
- **A string comparison where a file comparison belonged.** The resolver returns an
  unnormalised path, correctly. **The test was wrong, not the resolver.**

---

### Strengths

- **[STRENGTH]** The gap was found by asking what covers the function that actually broke,
  rather than by reading the diff of the thing that broke.
- **[STRENGTH]** The repo's own wiring guard caught the unwired test unprompted, so this is
  coverage rather than decoration, and I did not have to trust myself for it.
- **[STRENGTH]** Full suite 2918 pass, 0 fail, exit 0, arms confirmed by name.

### What I would tell the next person

**I nearly reported that my own test had not run.** I grepped the suite log while it was
still being written and found my arms absent, because `test:shell` runs **after**
`node --test`. **Absence in a log mid-write is not absence**, and the completion
notification is the signal. That is the sixth instrument error of this shape I have caught
myself in two days, and the only reason it did not become a claim is that I checked the
log again instead of writing it up.
