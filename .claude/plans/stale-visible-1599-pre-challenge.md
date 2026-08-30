---
pre_challenge: true
method: pre-challenge
branch: stale-visible-1599
diff_hash: 3b07696eef3d3d0a555dc6ba8f361e01826d51d93994b8a1cf29bd363c87908f
subdir_audit: passed
timestamp: 2026-08-30T22:23:32Z
converged: true
---

## [PRE-CHALLENGE] Self-review, stated as what it is

**This was a SELF-review, not a blind multi-agent challenge loop.** Recorded plainly
because a proof file is read later as evidence of how hard the work was looked at, and
"pre-challenge" and "challenge-loop" are not the same amount of scrutiny. One pair of eyes,
mine. A second reader is welcome and I have asked for one.

## 🛑 What this proof's diff_hash actually binds, which is more than my change

`3b07696eef3d3d0a555dc6ba8f361e01826d51d93994b8a1cf29bd363c87908f` covers **25 files and 4075 diff lines**. My change is **3 files**.

The gate computes `git diff main...HEAD`, where `main` is the **local** branch, and this
machine's local `main` is **19 commits behind `origin/main`**. So the hash certifies
kosmos#1615's and kosmos#1539's already-merged work as though I had reviewed it.

I did **not** fast-forward local `main` to fix this. `~/work/agent-workforce` is the shared
checkout every agent's gate reads, and another agent mid-flight may already have computed a
proof hash against it; moving it would invalidate their proof with no signal to them. That
is a decision, not an oversight, and it is the weaker of two bad options.

⇒ **Read this hash as binding my three files. The other 22 rode along.** The PR diff on
GitHub is computed against `origin/main` and shows only mine. Raised for Splinter as a gate
weakness rather than fixed here.

## Findings, all mine, all found and fixed inside this branch

- **[BLOCKER, mine] My change falsified a comment in `changeProviderNow`.** It documented
  that blanking `SWITCH_ACCT_SAID` SUPPRESSES the next `if (appearing)` announcement. With
  the gate gone that sentence is false, and a false comment is the defect this feature's own
  comments keep warning about --> FIXED, restated to say the cost is removed and why.
- **[WARNING, mine] My first control retired itself at merge.** It followed the repo's
  `git show origin/main:web/index.html` idiom, whose skip-guard fires once origin/main
  carries the fix, going green-forever. For a card whose whole subject is a guard aimed at
  the wrong question, a control that stops running is the wrong shape --> FIXED, rebuilt to
  reconstruct the pre-fix gate by surgery on the shipped page, and to FAIL rather than skip
  if the region moves.
- **[WARNING, mine] My test hand-built an agent card.** `fixture-discipline.test.js` caught
  it, not me. The rule is right: a stand-in carries fields the producer never emits --> FIXED,
  now uses `test-support/fleet`.
- **[CONVENTION, mine] My comment describing that lint tripped that lint.** It spelled the
  key pattern out, so the detector matched its own description --> FIXED, worded around it.
- **[NIT, mine] I wrote a mojibake character into a comment** with a bad escape, then damaged
  a line repairing it --> FIXED, verified by reading the block back.

## The verification that carries the claim

Perturbed arm by arm rather than trusting a green:

| perturbation | stale-while-visible | no-noise repaint |
|---|---|---|
| restore the `appearing` gate | RED | RED |
| drop only the content dedupe | GREEN | RED |
| shipped | GREEN | GREEN |

The **second row** is the one that matters: it proves the two assertions are aimed at
different properties rather than both riding on one change. `web/index.html` was restored
to its exact sha after each perturbation, checked.

Syntax checked with `node --check` on both inline script blocks, **with a control**: a
deliberately broken copy returns rc=1, the real one rc=0.

Full suite `npm test`: **3193 tests, 3193 pass, 0 fail** (post-rebase onto current
`origin/main`). All four of my tests confirmed present in that run by test name, since the
reporter prints names rather than filenames - the check I first got wrong by grepping for
the filename and reading a true zero as "my file never ran".

## Not done, deliberately

The two residuals the announcement block already documents for itself: the dropped
announcement when the region holds somebody else's sentence (wants a second polite region,
a markup change) and the silence for an account labelled only by a filesystem path (a copy
decision). Both are named in the block and neither is this card.
