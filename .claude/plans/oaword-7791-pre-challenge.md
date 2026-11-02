---
pre_challenge: true
method: challenge-loop
branch: oaword-7791
diff_hash: f3b44be04d27cddd1b867ef9be127679708e819061696922843d818e7f0f8357
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
- Clean: labelOf returns only fixed words apart from the model restart word; it reads no project name, account, path or screen text.
- Clean: same-site already carries account emails, so a model name there adds nothing new.
- Clean: every row path carries the word, offline rows too ("Not running", trust prompt, "Can't tell"), via withCardWords at the status route.
- Clean: a row withCardWords cannot label goes without a word, and the card falls back to the state's word.
- Clean: a stale card still shows no word (browser check CONTROL B asserts it).
- Clean: the word goes in through textContent only, never markup (unit test with a tag).
- Clean: oaAgentsOf is the page's only reader of the sibling agents; aoKeep picks its own fields; the iOS app reads /api/status whole.
- [NIT] the plan file was not reviewed: left.

## Measured
render-allagents-4812 headless in chromium and webkit: the other computer's agent reads "agent1s · Messages stuck", and it first FAILED because the page's row filter dropped the field (fixed). Page and server tests 43 of 43. Full suite left to CI.
