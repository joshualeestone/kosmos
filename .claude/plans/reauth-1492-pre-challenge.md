---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: reauth-1492
diff_hash: 32dfd0a62fa810930d795f4c3cfb53b08df56559fa7983a1cf625c4704d6ffa3
subdir_audit: passed
timestamp: 2026-08-29T17:18:02Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready). Bracketed markers because the
template's own heading is refused by this gate, my #1458.

**Routed to me by Splinter as item 1 of 4.** A real user's bug.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THIS ROUTE DOWNLOADS AND RUNS SOFTWARE**, per the suite's own comment on the
  cross-site guard. The new mode takes a **path from the request body**, which is the kind
  of input that deserves suspicion. It is validated by **exact membership in
  `accounts.list()`** after `path.resolve`, so an arbitrary path cannot reach
  `connect.start()`; a control asserts an unknown folder is refused AND not created. **A
  reviewer should still look hard at this specific line.**
- **[WARNING]** `path.resolve` on a relative input resolves against `process.cwd()`. It
  cannot create an account (membership is checked after), but it means a relative request
  is interpreted rather than refused. Named rather than buried.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword: the UI half is not built.

### NITs

- **[NIT]** The mode is checked before `another`, and both-together is refused, so order
  does not matter. Kept explicit anyway because a future edit could make it matter.

### Attacked and CLEARED

- **Perturbed four ways**, each failing the right test. Accepting an unknown folder breaks
  the control **and a pre-existing #248 test**. Restores sha-verified.
- **Collision measured, not assumed.** Angel's held `switch-acct-1373` differs from main in
  `server.js`, so I located her changes: lines **2543 to 2621**, inside
  `/api/agents POST`. This route is at **3707**, and her branch adds no new routes.
  **Over a thousand lines apart.**
- **Suite 2948 pass, 0 fail**, all four new tests present by name.

### Two defects of mine, caught before they shipped

1. **I wrote `nodePath.resolve` where server.js imports it as `path`.** `node --check`
   **passed**, because it validates syntax and not identifiers. It would have thrown at
   runtime, on the route a person reaches when they are already stuck.
2. **My first fixture tested the wrong refusal.** It used a prepared-but-unsigned directory,
   which `accounts.list()` correctly does not report, so the test failed for a reason that
   had nothing to do with the code. **Her account existed**; only the token had expired.

### What I am NOT claiming

**No person can use this yet.** There is no button. The route is reachable by a client that
knows to send `accountDir`, and nothing in the product sends it. **The card stays open for
exactly that reason**, and I would rather say so than let a merged PR read as a fixed
problem.
