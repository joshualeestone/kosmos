---
method: challenge-loop
branch: wnrank-7246
diff_hash: 42f017942024dfec8b68117a1e5cf734d5934be8adf42e2bb0ca2459d883676d
timestamp: 2026-10-30T16:53:54Z
iterations: 1
converged: true
---

# Challenge-loop proof: wnrank-7246 (one What's New rank, and the list rebuilt)

#### Iteration 1 (blind review)
No issues found. The reviewer rebuilt the list offline from this branch's pool: it equals the committed
web/whats-new.json exactly (so the #7617 freshness check passes); whats-new-check 0.7.76 rc 0 for mac and windows; a
semantic JSON diff against main shows only .items[91].rank 25 -> 15.2 in the pool, and in the list the room-posts item
in at position 2 with "Agents see the posts they follow" out. The item's words pass whatsnew.js problems() and match
the shipped behaviour (ec7a3b71da, an ancestor of the 0.7.73 archive, so since 0.7.73 is right).

What the reviewer checked, in full:
- [STRENGTH] The offline build's whole file, not only its highlights, equals the committed list (keys version and highlights).
- [STRENGTH] whats-new-check passes for --platform=mac (5 shown) and --platform=windows (2 shown): one untagged item
  replaced another, so the Windows count is unchanged.
- [STRENGTH] The pool already uses fractional ranks (1.1, 1.6), so 15.2 is an ordinary rank, not a new form.
- [STRENGTH] Title 38 characters (limit 48), line about 121 (limit 140), icon "chat" is in ICONS, no platform named, so
  it is rightly untagged; no em dash in any of the five spellings.
- [STRENGTH] The ranking: it sits between Sonnet pricing (15) and the Muse item (15.5), keeps the existing order, and is
  reversible in one line; the plan names its weakest premise.
- [NIT] Optional, not in this diff: the item's line describes how it works more than what the person gets (fewer turns
  spent on room chatter). That would be a wording edit to #7636's item, left as it is.

#### Validation
What's New tests 54/54 (tools.whats-new-check-3955, tools.whats-new-pool-5711, tools.whats-new-pool-sync-5713,
web.whatsnew-3955); prod-check rc 0. The full suites run in CI.
