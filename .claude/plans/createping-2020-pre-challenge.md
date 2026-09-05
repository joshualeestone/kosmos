---
pre_challenge: true
method: challenge-loop
branch: createping-2020
diff_hash: e38ba09b002a630008bd6ccf546a6532655d10222cee92830f7433822cae4406
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T21:12:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 7 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] web.create-tell.test.js — createTellPaint's #2047 403-safe read (refreshCreateTell `if(!res.ok)`) had no coverage --> FIXED (7bf98b37): pinned the guard on the source, matching sibling refreshers.
- [WARNING] web.create-tell.test.js:52 — createTellPaint's three-state behavior only presence-checked, not behaviorally tested --> FIXED (7bf98b37): restored a lift-based paint() helper and behavioral on/off/unread tests + a positive control.
- [NIT] web/index.html:16444 — refreshCreateTell omitted the epoch guard the sibling refreshers use --> FIXED (7bf98b37): added CREATE_TELL_EPOCH guard.
- [NIT] engine/ping.test.js:204 / notify.test.js — two failure messages described the expectation, not the failure --> FIXED (7bf98b37): reworded to describe the failure state.
- [NIT] web/index.html:8468 — on-screen copy names less than the payload sends (installId/os/version) --> DEFERRED: per Josh's explicit ruling the ping is event-only and IP/details are deliberately unnamed; payload carries nothing about the agent; Josh owns final wording (#2020 needs-release on wording).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings. Full-suite validation green (exit 0).
- [NIT] web/index.html:8467 — no test asserted the static markup lacks `checked` on #create-tell (the #258 flash-of-consent intent) --> FIXED (89fdcb8d): added a markup assertion with a positive control.
- [NIT] .claude/plans/ping-optout-2020.md — the earlier step-1 plan doc still stated the ping default was off --> FIXED (89fdcb8d): added a superseded note.
- [NIT] web/index.html:16428 — a brief async-refresh window can send tellKosmos:false on a very fast Create click --> DEFERRED: fails in the privacy-safe direction, the GET is local/near-instant, and createTellPaint(null) pre-paints; acceptable.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web.create-tell.test.js | 403-safe read untested | FIXED | 7bf98b37 |
| 2 | 1 | WARNING | web.create-tell.test.js:52 | painter three-state not behaviorally tested | FIXED | 7bf98b37 |
| 3 | 1 | NIT | web/index.html:16444 | refreshCreateTell no epoch guard | FIXED | 7bf98b37 |
| 4 | 1 | NIT | engine/ping.test.js:204 | muddled failure message | FIXED | 7bf98b37 |
| 5 | 1 | NIT | web/index.html:8468 | copy discloses less than payload | DEFERRED | Josh's ruling: event-only, wording is his |
| 6 | 2 | NIT | web/index.html:8467 | no #258 markup-not-checked assertion | FIXED | 89fdcb8d |
| 7 | 2 | NIT | ping-optout-2020.md | stale sibling plan doc | FIXED | 89fdcb8d |
| 8 | 2 | NIT | web/index.html:16428 | async-refresh window | DEFERRED | privacy-safe, local GET |

### NITs (non-blocking)
- All NITs above were either fixed or deferred with reasoning.

### Strengths (across both iterations)
- Two-gate send logic correct and well-covered: agentCreated requires wanted !== false AND read().on; the create request guards `b.tellKosmos = false` behind `!checked` so a ticked box or older client cannot silently opt anyone out.
- Inverted guards have genuine controls: id="create-go" anchors, codeOnly() comment-stripping with a stripper control, sandboxed data root so the default-ON assertions can actually fail, default+control asserted together (#2013).
- createTellPaint structurally enforces checked === enabled and treats unread as could-not-read (not Off); render-create-form measures rendered height>0.
- The default flip removed a latent inconsistency (ENOENT was {on:false} while a present-but-on-less file already returned {on:true}); the unreadable-file path still fails to OFF.
- Consent preserved despite default-ON: payload is event-only, informed default-checked control at the point of the act.
