---
pre_challenge: true
method: challenge-loop
branch: latest-sha-1920
diff_hash: d918ec2e852b502c941c2516ecbb71ae75492efbbf71634525ee9a7682b246af
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T23:46:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind review passes (plus a 6f validation catch)
**Converged:** Yes -- iteration 4 produced zero actionable findings (all STRENGTHs plus one
NIT the reviewer marked "no action needed within this card's scope").
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, several NITs (1 deferred).
**Fixed:** all actionable | **Deferred:** 2 (documented) | **Asked:** 0

The severity descended each pass (WARNINGs -> NITs -> a CONVENTION -> nothing), and every
pass confirmed the dangerous direction is closed: no path reports a corrupt, incomplete, or
unverifiable install as clean (exit 0 / ok:true). The controls are perturbation-honest --
two independent reviewers reverted the sha comparison and the version-selection and watched
exactly the right arms red.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 1 WARNING, 3 NITs
- [WARNING] selfCheck verified installed files against the LATEST manifest, so a machine one
  release behind mismatched every file. Fix: verify against the INSTALLED version's manifest
  (versioned name); report `behind` distinctly --> FIXED (da37b76f)
- [NIT] escapesRoot's `startsWith('..')` refused a file named `..foo` at root --> FIXED (da37b76f)
- [NIT] hashFile mislabelled any read error as `missing` (vs ENOENT) --> FIXED (da37b76f)
- [NIT] the latest.json `sha256` is not consumed in-code --> DEFERRED (the card's explicit
  cheapest fix for CLIENT/manual download verification; documented, not a defect)

#### Iteration 2
**New:** 2 WARNINGs, 1 NIT (all CLI-surface; core logic confirmed safe)
- [WARNING] the CLI success line printed `manifest undefined (running undefined)` -- it read
  keys the iter-1 refactor renamed, uncaught because nothing exercised the CLI. Extracted a
  pure `reportLines(r)` and tested it directly --> FIXED (2867c546)
- [WARNING] an INSTALLED machine with an unreadable app/package.json exited 0 (reported clean).
  Added an `installed` discriminator so reportLines exits 1 for an installed-but-unverifiable
  machine --> FIXED (2867c546)
- [NIT] surface `behind` on success --> FIXED (2867c546)
- caveats made explicit in code: TLS-only trust (disk-integrity, not anti-tamper) + symlink note

#### 6f validation catch (between iter 2 and 3)
- [BLOCKER-equivalent] engine.reachable.test.js (#265) flagged `fetchManifest` as a tested-but-
  unreachable export (nothing in production called it). Removed the seam; re-targeted its tests
  to `fetchLatestJson`/`fetchManifestNamed`, which selfCheck actually calls --> FIXED (bb9d6c87)

#### Iteration 3
**New:** 2 NITs, 1 CONVENTION
- [NIT] reportLines' success line not defensive about a missing installedVersion (would print
  "undefined") --> FIXED (97fab1ba, `|| '?'` + an arm)
- [NIT] the manifest cross-check skipped a manifest with a falsy version field --> FIXED
  (97fab1ba, reject a manifest that does not declare the installed version, fail loudly)
- [NIT] manifestNameFor reuses the latest pointer's arch --> DEFERRED (correct today, arm64-only;
  a documented multi-arch future concern)
- [CONVENTION] the plan file used 13 em dashes (Josh's no-em-dash rule) --> FIXED (97fab1ba)

#### Iteration 4
**New:** 0 actionable. All STRENGTHs + one no-action NIT (the documented TLS boundary). **CONVERGED.**

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | selfcheck.js | verified against latest manifest, not installed version | FIXED | da37b76f |
| 2 | 1 | NIT | selfcheck.js | escapesRoot refused `..foo` | FIXED | da37b76f |
| 3 | 1 | NIT | selfcheck.js | read error mislabelled as missing | FIXED | da37b76f |
| 4 | 1 | NIT | latest.json | sha256 inert in-code | DEFERRED | client/manual download verification, documented |
| 5 | 2 | WARNING | selfcheck.js | CLI printed `undefined` | FIXED | 2867c546 |
| 6 | 2 | WARNING | selfcheck.js | installed-but-unreadable exited 0 | FIXED | 2867c546 |
| 7 | 2 | NIT | selfcheck.js | surface `behind` | FIXED | 2867c546 |
| 8 | 6f | CONVENTION | selfcheck.js | tested-but-unreachable `fetchManifest` | FIXED | bb9d6c87 |
| 9 | 3 | NIT | selfcheck.js | reportLines undefined boundary | FIXED | 97fab1ba |
| 10 | 3 | NIT | selfcheck.js | manifest cross-check skipped falsy version | FIXED | 97fab1ba |
| 11 | 3 | NIT | selfcheck.js | manifestNameFor arch reuse | DEFERRED | multi-arch future, documented |
| 12 | 3 | CONVENTION | plan | 13 em dashes | FIXED | 97fab1ba |

### Deferred (with reasoning)
- The `sha256` in latest.json is not consumed by code in this change -- it is the card's
  explicit cheapest fix so a CLIENT can verify what it DOWNLOADED (install-time verification
  already uses the `.sha256` sidecar). Documented in the release.sh comment.
- `manifestNameFor` reuses the latest pointer's arch for the installed version's name --
  correct today (arm64 is the only released arch) and commented; a multi-arch future concern.
- TLS-only manifest trust: this is a disk-integrity / bit-rot / accidental-corruption check,
  NOT anti-tamper. Documented in the module header with the follow-up named (put the manifest's
  own sha in latest.json). Matches tools/verify-manifest.sh's existing trust model; the card's
  scope is the after-install disk-integrity gap.

### Strengths (across all iterations, independently confirmed)
- No false-OK path: from-source -> exit 0; installed-but-unreadable -> exit 1; unreachable
  latest.json/manifest and a version mismatch -> throw -> exit 2; corrupt/missing/bad -> exit 1.
  `ok` requires `checked>0 && no mismatches && no missing && no bad`; empty files[] is not a pass.
- The byte-corruption CONTROL and the behind-machine arm are real: reverting their fix reds
  exactly those arms (verified by two independent reviewers perturbing throwaway copies).
- Backward-compatible: `version` stays first; `engine/update.js` reads only `.version`; no test
  asserts a version-only shape. The sha is sourced from the `.sha256` sidecar verified in place.
- All 8 engine exports are reachable (engine.reachable.test.js green). Full suite: 3823/0.

## Delivery note
Kosmos beta app. Per the roster, Angel and Mona Lisa deploy to Kosmos; this PR is opened for
review, not self-merged. The change is forward-looking: it takes effect on the NEXT release cut
(release.sh writes the enriched latest.json) and the self-check is available immediately as a
CLI on any installed machine once shipped.
