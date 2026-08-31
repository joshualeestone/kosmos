# reports-wording-guard: the "Who you report to" block is asserted by nothing

kosmos#1676, follow-up. The wording landed in #1677; this guards it.

## Problem

PigeonPete found it while reviewing my fix: **the block written into every agent's instructions is asserted by no test anywhere.** It could be deleted today and the suite stays green.

Measured, with controls:

```
"You answer whoever sent the message"   0 test files
"who you escalate to"                   0 test files
"personLine"                            0 test files
"Reporting to them is not the same"     0 test files
CONTROL  "reportsTo"                     4 test files   (the search works)
CONTROL  an impossible string            0 test files   (it discriminates)
```

## The defaults.js half needs nothing, and proving that is part of this

The sibling block in `engine/defaults.js` is **also** named by no test, and it does not need one: `defaults.test.js` pins a fingerprint of the whole composed block against `DOCTRINE_VERSION`. Proven by perturbation rather than assumed:

```
live block                 92cbc9e7da9b313b   == pinned for v7
my #1673 section DELETED   6b112e796679a028   == the pinned hash for v6, exactly
```

⇒ Deleting it reproduces the v6 block byte for byte and reds the v7 pin. **That half is guarded. Writing a test for it would be redundant**, which is what this measurement is for: PigeonPete was about to write one.

`engine/reports.js` has no fingerprint and no version, so its properties have to be named one at a time.

## Change

A new `engine/reports.test.js`, five tests, asserting **properties rather than sentences**:

1. a managed agent is told reporting is not the same as being spoken to
2. a managed agent is told to answer the sender
3. the **managed** branch names the operator (the original #1676 mechanism was structural: `personName()` was called only in the no-manager branch)
4. `personLine` names a recorded operator and does not bold the fallback phrase as if it were a name
5. CONTROL: the no-manager branch is unchanged, and the managed-only sentence has not leaked into it

**Not the exact prose.** A test that pins sentences becomes the stale assertion it was written to prevent, which is the defect kosmos#1663 fixes one file over.

## Boundary with PigeonPete's #1676 delivery test

Agreed with him directly, so we do not write the same test twice:

- **His** (`server.reports-refresh-1676.test.js`) asserts the two sentences **as delivered content in an agent's file after boot**. They are load-bearing for his claim: without them boot could deliver a stale block and read as fixed.
- **Mine** asserts `blockBody()`'s **output**, at unit level.

Different questions, no duplication.

## Verification

**Every arm proven able to fail, each perturbation asserted applied before its result counted:**

```
drop "not the same as being spoken to"        applied=1   4 pass 1 FAIL
drop "answer whoever sent the message"        applied=1   4 pass 1 FAIL
managed branch stops naming the operator      applied=1   3 pass 2 FAIL
personLine bolds the fallback as a name       applied=2   4 pass 1 FAIL
managed-only sentence leaks into solo branch  applied=2   4 pass 1 FAIL
restored                                      5 pass 0 fail
```

## Weakest premise, named

These assert what `blockBody` **returns**, not what reaches an agent. That is deliberate (it is Pete's half) but it means a green here is compatible with the text never being delivered, which is exactly the gap kosmos#1676 exists for. **The two tests are only meaningful together.**
