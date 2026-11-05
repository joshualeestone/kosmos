---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0792
diff_hash: e250b9c6ed45ee4f7ee43fecce2416d48da77a9ce11678a304d3b2e1c9085a16
validation: passed (Mortals, full suite: 27342 tests, 0 failed, shell shards green, entry status clean, on the data commit ee4cd658c, with only this plan and proof after it; an earlier run on an older head tripped the #4273 leak guard on one temp folder from a disk image macOS would not detach, nothing left on the box, and did not recur)
subdir_audit: passed
timestamp: 2026-11-05T15:40:09Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Iteration 2's findings are all wording, taken as the reviewer wrote them; no further round.
**Total findings:** 1 BLOCKER, 3 WARNINGs, 4 NITs

What's New for 0.7.92. Prod moved to 0.7.91, so the pool marks its five shown and records lastProd. Two items are new, because
#8021 shows a new card and can reach a phone, and a person should be told what it is.

### Iteration 1 (the version-only build, before Josh's promote)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs on lines since replaced.
- [STRENGTH] rebuild byte-identical; whats-new-check passes mac and windows, wrong version refuses rc 3; prod-check rc 0.
- [NIT] "A new loading mark" and "A plain web address" had unstated limits --> no longer in the list: both shown by 0.7.91.

### Iteration 2 (the rebuilt list, every clause read against the code)
- [BLOCKER] "Agents see the posts they follow" was false: agents follow agents, and a busy run looks past replies rather than showing the newest --> FIXED (ee4cd658c: reworded, retitled)
- [WARNING] the stuck-messages line dropped idle: a working agent builds nothing --> FIXED (ee4cd658c)
- [WARNING] "is refused" overclaimed: a same-user agent can chmod past it --> FIXED (ee4cd658c: "ordinary edit fails")
- [WARNING] "so does your own" misread --> FIXED (ee4cd658c: "gemini you run yourself")
- [NIT, deferred] the Gemini line's mac tag may be too narrow: a Windows person is not told, which is silent rather than false.
- [NIT, deferred] Mac-tagged lines may not reach Linux: the window has no Linux tag.
- [STRENGTH] the pool diff is lastProd, five shown marks, two new items and these rewordings; 108 items unchanged.

Windows sees 2 of the 5, because three lines are Mac only.

### Weakest premise
That the stuck-messages line earns its slot: nobody has seen it on a real agent (PR #8025), so it may be rare, or noisy. The release entry says so. If it proves wrong it is one line in a pool.
