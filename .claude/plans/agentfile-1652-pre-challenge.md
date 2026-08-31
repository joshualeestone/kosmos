---
method: pre-challenge
branch: agentfile-1652
diff_hash: ad2fa689ec8b6be11ed51c7ec346e7ccb168d2df4ea89cb5fc17ebe8deda3521
explicit_override: true
---

# Pre-challenge: #1652 the portable agent file, export half

**Override reason:** self-review, not a `/challenge-loop` run. Stated rather than relabelled.

## What I challenged in my own change

**1. Am I inventing a format when one exists?**
This was the question worth asking first, because a second definition of "a described thing in a file"
is the defect this codebase keeps paying for. **It does exist:** `engine/skills.js:readMeta` already
parses `---` frontmatter, from a convention its own comment records as Claude Code's. ⇒ I reused the
shape and **wrote a test that round-trips the emitted file through that parser**, so the claim is
measured. If the agent file needed its own parser, that test fails.

**2. What must not travel, and did I check rather than assume?**
`id`/`idInstall` are the important ones and the reason is not privacy: they are minted once as an
anchor, so **two people importing one file would be the same agent.** Credentials I verified rather
than assumed: **no credential-shaped field exists in any of the 27 profiles on this machine**, so the
safe default costs nothing.

**3. Can the absence arms actually fail?**
An absence assertion is worthless if the matcher could never match. **They carry a control** - the
same containment check finds `provider`, which should be there - and **perturbing the writer to let
the id travel reds the safety arm.**

**4. Did my perturbations actually apply?**
Every one asserts it before its result counts. On another branch this morning I ran four perturbations
whose anchors silently matched nothing and got four confident `18 pass / 0 fail` results. **A
perturbation that does not apply is a green from a test that never changed.**

## Weakest premise, named

**Nothing consumes this yet.** Export is written, tested and exported, and **no caller exists** - no
button, no route, no CLI verb. So the format is verified against its own tests and the existing
parser, **not against a real import**. ⇒ **What would change my mind:** the first import
implementation finding the header underspecified. The likeliest gap is what happens when `name:`
collides with an agent that already exists on the importing machine - `registerOnly` refuses that
today, and whether import should offer a rename is a design call I deliberately left to whoever builds
it rather than pre-deciding from here.

📌 Second, smaller: **I did not implement the "give them instructions" half** Josh listed first. The
file is the harder half and the instructions are cheap to write once the format is settled, but they
are not written.

## Verified before opening this PR

- node suite **3252/3252, fail 0, rc=0**; my 9 tests present **by name** (9 lines naming #1652;
  positive controls #1649 -> 3 and #1582 -> 4; negative control -> 0)
- the total reconciles: 3239 + 4 (#1582's tests, merged this morning) + 9 = **3252**
- 0 em dashes in the diff

## Hash fidelity: exact this time

`diff_hash` binds **4 files for the 4 this branch changes**. Local `main` and `origin/main` are both
`5fbf5080`, so kosmos#1472's over-binding does not apply here. **I checked rather than pasting the
caveat I have used on my last four proofs** - it would have been false.
