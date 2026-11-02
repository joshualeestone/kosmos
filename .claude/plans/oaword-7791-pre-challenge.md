---
pre_challenge: true
method: challenge-loop
branch: oaword-7791
diff_hash: d6dad8e529c73bcba99e17945109d96688a65b0be2e3e9354be74074db00e6d1
subdir_audit: passed
timestamp: 2026-11-02T19:51:47Z
converged: false
---

## One blind review round, no blocker, findings fixed, not converged

Change: another computer's agent rows carry that computer's own card word, and the other-computers list paints it.

## Round 1
- [WARN] privacy: the restart word can carry a raw model name ("Switching to <model>"), and the cross-site answer (#4973) was meant to be fixed words only. FIXED: cross-site says "Switching model", tested; the comment no longer says every word is fixed.
- [NIT] slice(0, 40) can cut a surrogate pair from a model id: left, cosmetic.
- [NIT] nothing pinned the cross-site answer: FIXED, tested.
- Clean: every row path carries the word (offline rows too, via withCardWords); a stale card shows no word; the word is text only; no other consumer of the sibling answer breaks on a new key.

## Measured
render-allagents-4812 headless in chromium and webkit: the other computer's agent reads "agent1s · Messages stuck", and it first FAILED because the page's row filter dropped the field (fixed). Page and server tests 43 of 43. Full suite left to CI.
