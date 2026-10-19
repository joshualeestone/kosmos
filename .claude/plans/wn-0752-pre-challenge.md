---
pre_challenge: true
method: challenge-loop
branch: wn-0752
diff_hash: 3736e78cff4f1245ceb3cb60b8fa39ea9ab8b942647a3c1555179338b71c99db
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T14:23:20Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind accuracy reviews against the code)
**Converged:** Yes (iteration 2, sonnet: the highlight and the built web/whats-new.json are accurate; its one finding was
in the versions entry, which is not in this diff, and is fixed there)
**Total findings:** 1 MAJOR, 3 MINOR
**Fixed:** all | **Declined with reason:** 1 (family-join words: visible only to family accounts, not confirmed live) | **Asked (awaiting user):** 0

Validation: Mortals full suite on f33c9663ca (this diff), clean: 21227 tests, 0 failed, 0 cancelled. Mortals hashed with
ids at 9 (4c315b649d6a); mortals-validate's ladder matched it to this diff (local 9f88beaa63b9). The first run, on
63c45f1503, failed only the #1720 browser-check gate; the head commit now carries a Browser-check trailer, as five
earlier What's New commits did.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [MAJOR] the highlight said the unsent line goes "before your next message"; it goes only with the next message Kosmos types to that agent (any source, within 10 minutes, only Kosmos's own whole line) --> FIXED 63c45f1503 (title and line rewritten)
- [MINOR] the visible change was missing: Kosmos no longer types behind unsent text in a Claude agent's box --> FIXED 63c45f1503 (now the highlight)
- [MINOR] versions entry: the policy sentence's scope; the move-page wording --> FIXED in the entry (Mortals ~/.release-entry-0752.html)
- [NIT] the mac tag and the Claude-only scope --> CONFIRMED correct

#### Iteration 2
**Reviewer model:** sonnet
- No issues found above NIT in this diff.
- [MINOR] versions entry: a person's own send is refused, not held (only automatic senders are held) --> FIXED in the entry
- [NIT] family-join words not mentioned --> DECLINED: visible only to family accounts and not confirmed live for users
