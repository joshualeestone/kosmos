---
pre_challenge: true
method: challenge-loop
branch: codex-project-block-2245
diff_hash: 3be932ebb87dbdc4368bcd76f066f35860b4d7942538d07380ab7042e93069b4
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T17:58:40Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iterations 5, 6 and 7 each returned zero findings requiring a change to the reviewed diff)
**Total findings:** 6 WARNINGs, several NITs, 0 BLOCKERs, 0 CONVENTIONs
**Fixed:** 6 | **Deferred (documented / carded):** 6 | **Asked:** 0

The change (#2245): a Kosmos-created codex agent boots its brief from AGENTS.md
(discover.js), but the engine only wrote CLAUDE.md, so codex agents got neither
the doctrine (defaults.js) nor the per-project block (projects.js via
instructions.js). Fix: one `create.briefFilename(runner)` mapping applied at
every brief seam (birth write, instructions.fileFor, status.readIdentity), plus
setProvider MOVES the brief on a provider switch (a same-directory rename,
guarded to never clobber an existing destination). Full validation green
(4594/4594 tests, 253s). Reviewed by PigeonPete (the doctrine/block owner):
APPROVED.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] instructions.js:135 — fileFor resolves the dir via safeKey but the runner via readJob/NAME_RE, so a CONNECTED codex agent with a name outside NAME_RE routes its brief to CLAUDE.md --> DEFERRED: not a regression, fail-closed, Kosmos-created agents unaffected; fix touches readJob's path guard. Tracked in #2250.
- [NIT] instructions.js:57 — FILENAME='CLAUDE.md' no longer drives fileFor --> FIXED (b54065c3)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] create.js setProvider — a provider switch rewrote the plist runner but not the brief file, so a codex-born brief in AGENTS.md was lost on a switch to claude (a one-directional REGRESSION #2245 introduced) --> FIXED (15e5384d): setProvider now MOVES the brief via briefFilename; test asserts both directions move + preserve bytes.
- [NIT] instructions.js / status.js — repeated inline require('./create') --> FIXED (15e5384d): consolidated to one local.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] create.js:1186 — the brief-move swallow comment claimed "a later instructions refresh recreates the brief", but nothing on the switch path fires that refresh --> FIXED (35383cf0): reworded to state the residual honestly (near-impossible rename failure, does NOT self-heal).

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] create.js:1197 — renameSync clobbers an existing destination; a CONNECTED agent's own folder can hold both CLAUDE.md and AGENTS.md (discover.js), so a switch would overwrite a user-authored brief = data loss --> FIXED (5f2f1113): move only when the destination does not exist; test seeds both files and asserts neither is lost (red-capable).
- [NIT] instructions.js fileFor identifier asymmetry (safeKey vs raw name to readJob) --> DEDUP: same connected/non-birth path as the #2250 residual.
- [NIT] setProvider brief-move runs under DRY_RUN --> pre-existing (matches the ungated plist write); documented.

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] status.js / instructions.js — a codex agent created BEFORE this fix has its brief in CLAUDE.md but plist runner codex, so post-deploy the read seams momentarily resolve a not-yet-existent AGENTS.md --> NO CODE CHANGE: not a regression (such agents were already broken; codex boots AGENTS.md, never written), self-heals on the next doctrine pass. Documented as a rollout note (d3573134).
- [NIT] create.js — plist written before the rename (crash window) --> documented residual, accepted as written.

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] create.test.js — the no-clobber guard was only tested one direction --> FIXED (226ca3d1): added the reverse (codex-born-with-both -> claude) arm.
- [NIT] DRY_RUN asymmetry --> DEDUP of iteration 4's, pre-existing.
Reviewer verdict: "nothing that requires a code change."

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING (out of diff), 0 CONVENTIONs, 0 NITs
**Converged** — no findings requiring a change to the reviewed diff.
- [WARNING] tools/check-block-delivery.js:73,86 — a dev diagnostic reads only CLAUDE.md, so post-#2245 it cannot see codex agents --> DEFERRED: out of this diff, not a merge blocker, filed as #2259.
Reviewer verdict: "the branch is ready as-is."

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | instructions.js:135 | Connected-agent name-regime routes brief to CLAUDE.md | DEFERRED | #2250 |
| 2 | 1 | NIT | instructions.js:57 | FILENAME no longer drives fileFor | FIXED | b54065c3 |
| 3 | 2 | WARNING | create.js setProvider | Switch did not move brief (codex<->claude regression) | FIXED | 15e5384d |
| 4 | 2 | NIT | instructions.js/status.js | Repeated inline require('./create') | FIXED | 15e5384d |
| 5 | 3 | WARNING | create.js:1186 | Swallow comment overstated recovery | FIXED | 35383cf0 |
| 6 | 4 | WARNING | create.js:1197 | renameSync clobbers existing destination (data loss) | FIXED | 5f2f1113 |
| 7 | 4 | NIT | instructions.js fileFor | Identifier asymmetry | DEDUP | #2250 |
| 8 | 4 | NIT | create.js setProvider | Brief-move under DRY_RUN | DOCUMENTED | pre-existing |
| 9 | 5 | WARNING | status.js/instructions.js | Pre-fix codex agents migration transient | NO CHANGE | rollout note d3573134 |
| 10 | 5 | NIT | create.js | Plist-before-rename crash window | DOCUMENTED | accepted residual |
| 11 | 6 | NIT | create.test.js | No-clobber test one-directional | FIXED | 226ca3d1 |
| 12 | 7 | WARNING | tools/check-block-delivery.js | CLAUDE.md-only, blind to codex agents | DEFERRED | #2259 (out of diff) |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- [NIT] create.js setProvider brief-move runs under DRY_RUN (pre-existing; matches the ungated plist write it depends on).
- [NIT] create.js plist is written before the rename (a near-impossible crash window; documented honestly, does not self-heal).

### Strengths (across all iterations)
- Path-injection safe: briefFilename returns one of two string literals, so a runner value can never contribute a path segment; safeKey + the file.startsWith(dir + path.sep) containment guard are intact.
- No split-brain: birth write passes the in-scope runner (plist not yet written); all post-birth readers derive from the recorded plist runner and agree.
- The no-clobber guard fixes the regression for a Kosmos-created agent (one brief, always moves) AND avoids data loss for a connected agent holding both files.
- Tests are genuinely red-capable: forcing briefFilename to CLAUDE.md reds the codex test; dropping the no-clobber clause reds the data-loss assertions.
- Doctrine/block reused verbatim, not duplicated; the doctrine string reaches the codex AGENTS.md.
- No em dashes in any added line (all five spellings checked); comments use --.
