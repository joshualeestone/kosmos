---
pre_challenge: true
method: challenge-loop
branch: win-alias-publish-2008
diff_hash: b2e8bd49628cf499dc5aa5cbc4b7ad7a15d47a1aa9ca026670d20a668e0baf2e
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T17:18:09Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (converged at iteration 9)
**Converged:** Yes
**Total findings:** 6 BLOCKERs/WARNINGs/CONVENTIONs actioned + several NITs
**Fixed:** all actionable | **Deferred:** 3 (2 documented weakest-premise / cosmetic NITs at iter 9, 1 CONVENTION at iter earlier) | **Asked:** 0

The tool (`tools/publish-kosmos-windows.sh`) stages a built Windows zip into a site
checkout's `dist/` under a stable unversioned ALIAS (`kosmos-win-<arch>.zip`, what the
download button fetches) plus a VERSIONED copy, with verified sha256 sidecars and a
`latest-win.json` manifest. It reads the version from the zip's own baked
`app/package.json`, refuses a version OR arch containing anything but `[0-9A-Za-z.+_-]`
(path-escape), refuses to republish DIFFERENT bytes under an existing versioned name
(immutability), and does NOT deploy.

### Per-Iteration Breakdown

#### Iterations 1, 3, 5 (pre-compaction, this branch's earlier session)
Committed as `dee89cc1`, `6bc576a4`, `c71829ff`. Established the core design and fixed:
the immutability-guard ordering (guard BEFORE any cp, so a refusal leaves dist untouched),
a vacuous copy-pasted test filter replaced with an empty-dist assertion, node/unzip
dependency checks, exact node version parse (not a sed heuristic), and an idempotency-test
flake (reuse one zip vs re-zip, since zip embeds 2s-granular DOS mtimes).

#### Iteration 7 (commit 2aa0fd89)
**New findings:** 1 WARNING, 3 NITs
- [WARNING] tools/publish-kosmos-windows.sh:81 - the mutable alias can be silently repointed BACKWARD (re-publishing an old zip to regen a sidecar passes the immutability guard, then clobbers the alias); the "newest build" comment was factually wrong --> FIXED (corrected comment + added a NOTICE on repoint)
- [NIT] tools/publish-kosmos-windows.sh:37 - ARCH interpolated into filenames without the VERSION path-escape guard --> FIXED (applied the same `case` guard to ARCH)
- [NIT] test - explicit `[<version>]` arg path untested; no positive control that a legit `+`/`_` version is accepted --> FIXED (added both arms)
- [NIT] staging is non-atomic (2nd cp could fail after alias cp) --> DEFERRED: staging dir (not served), rerun recovers, mirrors release.sh's own pattern

#### Iteration 8 (commit 6bdffe85)
**New findings:** 2 WARNINGs, 2 CONVENTIONs
- [WARNING] test - the new ARCH guard had no test --> FIXED (added a reject arm: `KOSMOS_WIN_ARCH=../x` refused, nothing staged)
- [WARNING] test - the new alias-repoint NOTICE was untested --> FIXED (added a stderr arm: forward-quiet / same-version-quiet / republish-fires)
- [CONVENTION] tools/publish-kosmos-windows.sh:86 - the NOTICE fired on ANY version change (every forward release), training the operator to ignore it --> FIXED (retargeted to fire ONLY on re-publishing an already-present version while the alias names a different one, via a `VERSIONED_PREEXISTED` flag captured before any cp; message no longer claims a numeric direction)
- [CONVENTION] tools/publish-kosmos-windows.sh:121 - `artifact` field is the alias here vs the versioned name in release.sh's latest.json --> DEFERRED: deliberate and documented in-script (the Windows button needs the stable alias; a note for the #2014 consumer, not a code change)

#### Iteration 9 (converged, no code change)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - the fresh blind pass found no actionable findings. It confirmed the
`VERSIONED_PREEXISTED` refactor is correct (captured before any cp, both consumers read
the same snapshot), the NOTICE fires on exactly the intended set (walked all six cases),
and it fails soft on corrupt/absent `latest-win.json` under `set -eu`.
- [NIT] tools/publish-kosmos-windows.sh:141 - `latest-win.json` is single-arch (unqualified) --> DEFERRED: the plan explicitly scopes x64-only as its weakest premise; a second arch would need an arch-qualified manifest
- [NIT] tools/publish-kosmos-windows.sh:88 - `cmp -s` exit 2 on an unreadable existing file yields the "DIFFERENT bytes" refusal message --> DEFERRED: cosmetic; the behaviour is safe (it refuses rather than clobbers)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 7 | WARNING | publish-kosmos-windows.sh:81 | alias silently repoints backward + wrong comment | FIXED | 2aa0fd89 |
| 2 | 7 | NIT | publish-kosmos-windows.sh:37 | ARCH lacks path-escape guard | FIXED | 2aa0fd89 |
| 3 | 7 | NIT | test | explicit-version path + accept control untested | FIXED | 2aa0fd89 |
| 4 | 7 | NIT | publish-kosmos-windows.sh:99 | non-atomic staging | DEFERRED | staging dir, rerun recovers |
| 5 | 8 | WARNING | test | ARCH guard untested | FIXED | 6bdffe85 |
| 6 | 8 | WARNING | test | alias-repoint NOTICE untested | FIXED | 6bdffe85 |
| 7 | 8 | CONVENTION | publish-kosmos-windows.sh:86 | NOTICE fired on every forward release | FIXED | 6bdffe85 |
| 8 | 8 | CONVENTION | publish-kosmos-windows.sh:121 | artifact field diverges from release.sh | DEFERRED | deliberate + documented |
| 9 | 9 | NIT | publish-kosmos-windows.sh:141 | single-arch manifest | DEFERRED | x64-only weakest premise |
| 10 | 9 | NIT | publish-kosmos-windows.sh:88 | cmp exit-2 message | DEFERRED | cosmetic, safe |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] single-arch `latest-win.json` (iter 9) - documented x64-only scope
- [NIT] `cmp -s` exit-2 message wording on an unreadable file (iter 9) - cosmetic

### Strengths (across all iterations)
- Immutability guard ordered before every cp; a refused republish leaves the WHOLE dist byte-for-byte unchanged (test snapshots all of dist, not just the versioned copy)
- Version read from the zip's own package.json via node, with a discriminating control (fixture version != repo version) that goes red if the script reads the repo instead
- The repoint NOTICE fires on exactly the hazard set (re-publish of a pre-existing version), not on normal forward releases - avoids cry-wolf
- Pipes and substitutions fail closed by content (`[ -n "$VERSION" ]`, `[ -n "$PREV_V" ]`), not by exit code; POSIX-clean, `sh -n` passes; all 8 test arms red-capable
