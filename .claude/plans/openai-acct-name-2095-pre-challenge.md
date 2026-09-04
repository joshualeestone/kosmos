---
pre_challenge: true
method: challenge-loop
branch: openai-acct-name-2095
diff_hash: b780e4cbc6decca7077eab010128d22dc6d8b20ab3947264bd310c2eb136cc2a
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T03:32:07Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 WARNINGs, 6 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 3 WARNINGs + the worthwhile NITs | **Deferred:** 0 | **Asked:** 0

Note: 6g/6j validation was blocked for ~20 min mid-loop by the 0.6.28 release cut
reserving the machine; I refused `KOSMOS_IGNORE_MACHINE_CLAIM` (it could red the live
cut and corrupt my result) and armed a poller that ran the full suite the moment the
box freed. All validation gates passed green once the box was free.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
- [WARNING] engine/openaiaccounts.js — addWithKeyLive's live-rejection undo left the
  `.kosmos-name` sidecar behind on the reused-auth-less-dir (`!madeDir`) branch, so a
  later add reusing the slot (nextWorkDir) could inherit a stale name from a DIFFERENT
  account. --> FIXED (undo now removes the name file too; test added). commit ddf0afc8
- [WARNING] engine/openaiaccounts.js — the name was stored/served with no length cap;
  a raw API call (the form input caps at 40, the HTTP route does not) could bloat every
  /api/accounts response; and the deferred frontend is an XSS surface. --> FIXED (120
  clamp in writeName; XSS escape requirement added to the handoff doc). commit ddf0afc8

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the handoff doc named the served field but did not explicitly require
  HTML-escaping the raw name in the deferred render. --> FIXED (plan now mandates
  textContent/escape, with the concrete `<img onerror>` attack named). commit db4a60cc
- [NIT] the 120 clamp sliced by UTF-16 unit, so an emoji at the boundary could store a
  lone surrogate (U+FFFD). --> FIXED (code-point-safe `[...s].slice().join().trimEnd()`).
- [NIT] trim-then-slice could store a trailing space. --> FIXED (trimEnd after clamp).
- [NIT] the made-dir undo branch's name cleanup was untested. --> FIXED (test added).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new actionable findings. The 2 NITs were applied as polish:
- [NIT] readName did not re-apply the clamp on the serve path. --> FIXED (re-clamp on
  read so the bound holds however bytes reached the file). commit b7b172ec
- [NIT] the emoji test asserted only the negative. --> FIXED (positive assertion that
  the astral char survives whole + lands at exactly 120 code points). commit b7b172ec

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | reject-undo orphans .kosmos-name -> stale-name leak | FIXED | ddf0afc8 |
| 2 | 1 | WARNING | no length clamp; deferred-XSS surface | FIXED | ddf0afc8 |
| 3 | 2 | WARNING | handoff doc did not mandate HTML-escape | FIXED | db4a60cc |
| 4 | 2 | NIT | UTF-16 clamp could split a surrogate | FIXED | db4a60cc |
| 5 | 2 | NIT | trailing space after clamp | FIXED | db4a60cc |
| 6 | 2 | NIT | made-dir undo branch untested | FIXED | db4a60cc |
| 7 | 3 | NIT | readName did not re-clamp on serve | FIXED | b7b172ec |
| 8 | 3 | NIT | emoji test asserted only the negative | FIXED | b7b172ec |

### Outstanding questions (ASKED)
None.

### Strengths (across all iterations)
- Fail-open is airtight: readName try/catches every error class (missing / unreadable /
  directory-shaped file) -> name:null, never throws or drops an account; guarded by a
  dangerous-answer control test.
- The stale-name leak is closed on BOTH undo branches (made-dir whole-dir rm; reused
  auth-less dir explicit auth.json + name-file removal), each with its own test.
- Security sound: the sidecar never holds the key; no path traversal (dir is
  homeDir + a cleanLabel-slugged segment); clamp is code-point-safe.
- The `name` field is purely additive; no existing consumer (create.js, connections.js,
  the Claude accounts.js row shape) reads it. The deferred-XSS handoff is sufficient and
  actionable (names the field, the attack, the fix, and both render surfaces).

### Handoff (in the plan): the frontend DISPLAY of `account.name` is deferred to a
browser-capable session per Splinter's routing (my browser constraint), with the served
field, the two render sites, and the mandatory HTML-escape all documented.
