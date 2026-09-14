---
pre_challenge: true
method: challenge-loop
branch: dm-unread-2863
diff_hash: 5bf67170336f3b03e2d1855ed05f79ea269b8a5a797956ba3c256090bce04bd8
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T04:43:13Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 6 (0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 3 NITs)
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (first blind pass; ITER_COMMITS empty, 6.0 baseline passed clean)
- [WARNING] engine/chat.dm-unread-2863.test.js:54 — cursor test straddles the cursor but never lands a reply exactly ON it, so the `at <= since` exact-equality edge is unasserted --> FIXED (1323a3eb): added a boundary test with a reply at exactly T_CURSOR.
- [WARNING] server.test.js — HTTP test covers only the happy path; missing the 400 route path (BAD_THREAD only unit-tested) and a blanket every-agent dmUnread shape assertion (precedent #670 loops all) --> FIXED (1323a3eb): added a route-400 test and a loop asserting every agent carries a well-typed dmUnread.
- [WARNING] server.js:withDmUnread / engine/chat.js:dmUnreadAll — uncached readdirSync + per-thread readFileSync on every 5s /api/status poll, no memoization --> DEFERRED: precedent-consistent (messages.unreadAll re-parses the whole log every poll), reads are small per-file and bounded by fleet size, and a cache would need invalidation on every reply append (the complexity the room precedent deliberately avoids). Documented in-code in dmUnreadAll's docblock. Iteration 2 (opus) independently re-raised this and confirmed it is acceptable.
- [CONVENTION] .claude/plans/dm-unread-2863.md:39-43,63 — em dashes violate the fleet no-em-dash house style --> FIXED (1323a3eb): replaced with commas.
- [CONVENTION] engine/chat.dm-unread-2863.test.js:4,14 — same em-dash issue in the docblock --> FIXED (1323a3eb).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (the perf WARNING re-raised and confirmed acceptable, matching DEFERRED entry #3)
**Converged** — no new actionable findings; the sole WARNING deduplicated to the deferred perf item, remaining findings were NITs/STRENGTHs.
- [NIT] engine/chat.js:dmUnread — keys by raw all[String(agent)] while counts key by the safeKey form; dmUnread('April') would return a false 0. Latent only: no caller passes a non-normalized name (the route uses markDmSeen, withDmUnread reads dmUnreadAll keyed by the already-safe sessionName), and it matches the precedent messages.unread's un-normalized lookup. Left as-is.
- [NIT] tests — two documented branches unexercised: whole-map null on a non-ENOENT chats-dir readdir failure, and withDmUnread's whole-payload null branch. Both hard to trigger portably; the load-bearing per-agent-null and cursor-null paths are covered. Left as a completeness note.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | chat.dm-unread-2863.test.js:54 | BRANCH | exact-cursor-boundary unasserted | FIXED | 1323a3eb |
| 2 | 1 | WARNING | server.test.js | BRANCH | missing 400 path + blanket shape assert | FIXED | 1323a3eb |
| 3 | 1 | WARNING | chat.js/server.js | BRANCH | uncached reads per 5s poll | DEFERRED | precedent-consistent, documented in-code |
| 4 | 1 | CONVENTION | plans/dm-unread-2863.md | BRANCH | em dashes | FIXED | 1323a3eb |
| 5 | 1 | CONVENTION | chat.dm-unread-2863.test.js | BRANCH | em dashes in docblock | FIXED | 1323a3eb |
| 6 | 2 | NIT | chat.js:dmUnread | BRANCH | latent name-normalization | DEFERRED | no caller; matches precedent |

### NITs (non-blocking)
- [NIT] engine/chat.js:dmUnread — latent name-normalization false-0 (iteration 2).
- [NIT] tests — two hard-to-trigger branches unexercised (iteration 2).

### Strengths (across all iterations)
- Faithful mirror of the messages.js/withUnread/project-/seen precedent, with one reasoned, in-code-documented divergence (per-agent null on a damaged DIRECT thread vs the room log's whole-map null, because DIRECT threads are independent files) that is a genuine improvement and has its own dedicated test.
- Unknown is never reported as zero at either scope; a badge-computation failure degrades to null rather than 500ing the /api/status payload (try/catch in withDmUnread; dmUnreadAll cannot throw).
- Security posture sound: the new route inherits the global crossSiteWrite/remoteWriteGuard/board-token gates, safeKey round-trip prevents thread-key collisions, the DIRECT_THREAD_FILE two-dot regex cannot pick up a project thread, and a bad name maps to 400 (not the precedent's blanket 500).
- Tests assert meaningful outcomes end-to-end (the wiring test proves dmUnread reaches the live /api/status payload and clears via the real HTTP route), including the exact cursor edge.

### Validation note
Full suite on the converged HEAD (1323a3eb): 6253 pass, 1 fail. The single failure was `#1968: the bridge presents the board token` in codex-report-bridge.test.js, a slow (7.5s) board-token bridge test entirely unrelated to this change (DM unread) that timed out under heavy concurrent test load; it passes 9/9 when re-run alone. Baseline validation of the pre-change HEAD passed clean (6252 pass, 0 fail, cut guard 0 failures).
