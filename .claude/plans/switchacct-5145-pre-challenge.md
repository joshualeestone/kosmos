---
pre_challenge: true
method: challenge-loop
branch: switchacct-5145
diff_hash: 5f33a785a2783359573830866bf58d783f3068b38b2e5e6621af904357682dc6
validation: passed (focused at a9aadb5a9: web.switch-landed-5145 22/22, the #5145 route tests 5/5; the full suite and the FULL browser checks are queued after this proof)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-04T17:36:19Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**A fresh loop (2026-10-04).** The branch was reviewed in 3 rounds on 2026-10-03, but that loop's proof was never
written and its ledger was not kept. Rather than write one from memory, this loop reviewed the branch from scratch.

**Iterations:** 8, alternating Opus and Sonnet. **Converged:** yes. Round 8 had only NITs.
**Total findings:** 13 actionable (0 BLOCKERs, 12 WARNINGs, 1 CONVENTION), plus NITs.
**Fixed:** 9 | **Deferred:** 4 (accepted in the plan, with reasons) | **Asked:** 0

### Per-Iteration Breakdown
- **1 (opus):**
  - [WARNING] a landed dir was compared to rows exactly, so an env-override default with a trailing slash failed --> FIXED (rowFor matches ignoring trailing separators and records the row's own dir; red without it).
  - NITs taken: a Claude unlisted-pick row; the route comment.
- **2 (sonnet):**
  - [WARNING] Windows separators and drive-letter case --> FIXED (bare() unifies them; a control row shows only the drive letter folds).
  - [WARNING] the sent-dir fallback recorded an unlisted dir --> FIXED (records nothing).
  - Self-generated: 1 (round 1's code).
- **3 (opus):**
  - [WARNING] the doc comment stated the old rules --> FIXED.
  - [CONVENTION] the plan's call was stale --> FIXED.
  - NITs taken: the wrap, the arm title.
- **4 (sonnet):**
  - [WARNING] "the record always names a real row" was false for a Claude pick --> FIXED.
  - [WARNING] ACCOUNTS is read once --> DEFERRED (it fails safe; a re-fetch would add a live sweep to every switch).
  - [WARNING] the server resolves while the page normalises --> DEFERRED (round 1's call).
- **5 (opus):**
  - [WARNING] a partial carrying accountDir recorded the landed account, kept out only by the caller --> FIXED (the in-function guard, plus 2 rows).
- **6 (sonnet):**
  - [WARNING] a Claude pick was not normalised to its row --> FIXED (1 row).
  - [WARNING] a stale-list Claude records nothing, not main --> DEFERRED (a deliberate rule, pinned by a row).
  - [WARNING] ACCOUNTS once --> duplicate of round 4.
- **7 (opus):**
  - [WARNING] the comment above the recording step claimed "never no account" --> FIXED (it states the stale-list exception and why).
  - NITs taken: the server comment, the plan backstop note.
- **8 (sonnet):** NITs only. **Converged.**

### Final Ledger
| # | Iter | Cat | File | Origin | Description | Status |
|---|---|---|---|---|---|---|
| 1 | 1 | W | web/index.html | BRANCH | exact dir compare | FIXED |
| 2 | 2 | W | web/index.html | SELF | Windows spellings | FIXED |
| 3 | 2 | W | web/index.html | BRANCH | unlisted sent dir recorded | FIXED |
| 4 | 3 | W | web/index.html | SELF | stale doc comment | FIXED |
| 5 | 3 | C | plan | SELF | stale call | FIXED |
| 6 | 4 | W | web/index.html | SELF | "always a real row" | FIXED |
| 7 | 4 | W | web/index.html | BRANCH | ACCOUNTS read once | DEFERRED |
| 8 | 4 | W | server.js | BRANCH | resolve vs stored string | DEFERRED |
| 9 | 5 | W | web/index.html | BRANCH | partial records landed | FIXED |
| 10 | 6 | W | web/index.html | BRANCH | Claude pick not normalised | FIXED |
| 11 | 6 | W | web/index.html | BRANCH | stale-list Claude -> nothing | DEFERRED |
| 12 | 7 | W | web/index.html | BRANCH | comment "never no account" | FIXED |
| 13 | 6 | W | web/index.html | BRANCH | ACCOUNTS once (duplicate) | DEFERRED |

### NITs (non-blocking)
- [NIT] The restart-failed partial carries an accountDir that nothing reads (round 8).
- [NIT] bare() would fold two filesystem roots together; no account dir is a root (round 8).
- [NIT] Arm 11b3's no-bracket check passes either way; its "NOT recorded" check is the real guard (rounds 4, 8).
- [NIT] Arms 11b2 and 11b3 duplicate their setup (rounds 1, 5, 8).
