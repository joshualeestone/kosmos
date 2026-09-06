---
pre_challenge: true
method: challenge-loop
branch: fix-2250-recorded-runner
diff_hash: 539d2b32f356ba592dc0fa28e652eb6c617fe9bda386ad61a6bcb95f3c1b8ef4
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T00:24:01Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 6 (1 BLOCKER, 0 WARNINGs, 1 CONVENTION, 3 NITs; plus 1 baseline test-suite failure covering 2 tests)
**Fixed:** 5 | **Deferred:** 0 | **Asked:** 0

Card: kosmos#2250. Scope: a shared `create.recordedRunner(name)` helper (plist
first via `readJob`, profile `provider` as the fallback) routed through the three
sibling callers `instructions.fileFor`, `status.readIdentity`,
`create.instructionFile`, so a CONNECTED codex agent whose name fails `NAME_RE`
has its brief/identity resolved to AGENTS.md rather than the CLAUDE.md it never
wrote. `readJob`'s `NAME_RE` guard on `plistPath` (the path-traversal surface) is
untouched.

### Initial validation (6.0 baseline)

Full node suite + shell tests. **Two `#1652` agentfile tests failed** (one root
cause): `engine/agentfile.test.js:75` and `engine/agentfile.import.test.js:213`.
Both fixtures set `provider: 'openai'` on an agent but wrote the brief to
CLAUDE.md — an inconsistent state that only ever passed because `fileFor` ignored
the profile provider. My change (correctly) resolves such an agent to AGENTS.md,
so the export half found no instructions file.
- [BLOCKER] agentfile fixtures — codex-provider agent with a CLAUDE.md brief -->
  FIXED (commit cbc0f475): the fixtures now write AGENTS.md for a codex agent
  (matching `briefFilename('codex')` and where a real codex agent's brief lives).
  Verified legitimate (not a masked product regression) by the iteration-2 review.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (blind review) +
the 2 baseline failures above.
- [NIT] engine/create.js — the `recordedRunner` "never throws" comment credited
  `safeKey` rejection; the default actually comes from `readProfile` returning
  `{}` --> FIXED (commit cbc0f475): comment tightened.
- [NIT] engine/status.js:3774 — `readIdentity` routed through the shared helper
  but had no direct test --> FIXED (commit cbc0f475): added a discriminating
  readIdentity test (decoy in CLAUDE.md, real in AGENTS.md, plus a claude control).
- [NIT] engine/create.test.js — the `'../evil'` control message said safeKey
  "rejects" it; safeKey sanitises `'../evil'` -> `'evil'` --> FIXED (commit
  cbc0f475): message corrected.
- [STRENGTH] plist-first precedence proven with a red-capable control; no new
  traversal surface; no healthy-agent regression; mapping matches the board.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs.
**Converged** — "No issues found." Independent confirmation that `readJob`'s guard
is untouched, precedence is plist-authoritative with a discriminating control, the
`provider === 'openai'` mapping is complete, the agentfile fixture changes are
legitimate (a real codex export reads AGENTS.md), the readIdentity test is
discriminating, and `recordedRunner` is total.

### Final validation (6j)

Full node suite on the exact converged HEAD (cbc0f475): **4729 tests, 4729 pass,
0 fail, 0 cancelled, 0 skipped**; `yarn test:shell` passed; the #1720 browser-check
gate passed (no `web/` change). Green.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/agentfile.test.js:75 (+import.test.js:213) | #1652 fixtures wrote a codex brief to CLAUDE.md | FIXED | cbc0f475 (write AGENTS.md) |
| 2 | 1 | NIT | engine/create.js | never-throws comment imprecise | FIXED | cbc0f475 |
| 3 | 1 | NIT | engine/status.js:3774 | readIdentity had no direct test | FIXED | cbc0f475 (added test) |
| 4 | 1 | NIT | engine/create.test.js | '../evil' control message imprecise | FIXED | cbc0f475 |
| 5 | - | CONVENTION | .claude/plans/ | No plan file for this branch | FIXED | Added `.claude/plans/fix-2250-recorded-runner.md` (the pre-challenge-gate requires it). |

### Strengths (across all iterations)
- The path-traversal guard (`readJob`'s `NAME_RE` check before `plistPath`) is
  genuinely untouched; the fix only reads the profile via the already-safe
  `readProfile`/`safeKey` path.
- Plist-first precedence, proven by a discriminating control (a claude plist plus
  an `openai`-claiming profile must resolve `claude`) that fails under a
  profile-first implementation.
- One shared helper removes the prior three-way divergence, matching the module's
  own "one reader, not two careful callers" doctrine.
- The agentfile export path now reads AGENTS.md for a codex agent, fixing a latent
  gap for connected/plist-less codex agents as a positive side effect.
