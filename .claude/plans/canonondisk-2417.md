# Plan: #2417 - sweep engine/ path comparisons for missing trust.canonicalOnDisk

## The class
A RECORDED/DERIVED path (a profile dir, a hardcoded 'work' folder, a launch folder Kosmos
chose) compared against an ON-DISK/getcwd path (a transcript/rollout `meta.cwd`, `process.cwd()`,
a disk-scanned folder). On macOS (case-insensitive, case-preserving) plain `fs.realpathSync`
resolves the `/private` symlink twin but PRESERVES input case, so a case-divergent match is
MISSED. `trust.canonicalOnDisk` = `fs.realpathSync.native` (folds case + `/private` + unicode
exactly as getcwd / std::fs::canonicalize) with a `path.resolve` fallback -- the one answer.

## Method
Per site: is it comparing a RECORDED/DERIVED path against an ON-DISK/getcwd one, with case/
/private divergence REACHABLE? If yes -> switch to canonicalOnDisk + an armed test. If both
sides are the same kind (both derived, or both on-disk), or the compare is symmetric/a self-
resolution/a dedup key, or the only reachable symptom is safe -> LEAVE with the reason.

## Verdicts

### FIX (1 site)
- **engine/codexsession.js `forWorkdir`** -- the one true recorded-vs-getcwd site. `want` is the
  launch folder Kosmos DERIVES; `meta.cwd` is the ON-DISK spelling codex wrote via
  std::fs::canonicalize. Plain realpathSync on both sides folded /private but preserved case, so
  a case-divergent launch folder never matched its rollout and the OpenAI ring read "not yet"
  (the #2257 symptom via this door, deferred here on purpose). FIXED: both sides through
  trust.canonicalOnDisk. Armed case-variant test (skips on a case-sensitive fs); reverting to
  plain realpathSync reds it. Also updated two now-stale status.js comment blocks that described
  this door as open.

### LEAVE (with reason)
- **engine/accounts.js 168/367/444** -- three `realpathSync(X) === realpathSync(Y)` compares.
  BOTH sides DERIVED (built from `dir`/`homeDir()`), symmetric, and the function's contract is
  "false on any doubt". The compare resolves a KNOWN symlink + the /private twin; the only way to
  reach a case divergence is a hand-wired symlink whose stored target case differs, which reads as
  "not shared" -- the designed safe direction. Not the recorded-vs-getcwd class.
- **engine/delete-leftover.js:192** -- a DELETE guard, `insideDir(realpathSync(folderPath),
  realpathSync(WORKERS_DIR))` (containment, not equality). Recorded-vs-derived in shape, BUT the
  only reachable case symptom is a benign SKIPPED cleanup (a case-divergent recorded worker dir
  reads as not-inside -> refuse -> leftover survives). The dangerous direction (delete something
  OUTSIDE workers) is NOT introduced by case: case-preservation UNDER-matches (stricter), and
  folding case with canonicalOnDisk would only make a delete guard MORE permissive. Do not loosen
  a delete guard. LEAVE (noted: a case-divergent recorded worker dir can't be cleaned via this path).
- **engine/reporthook.js 230/259** -- 230 resolves the tmp root for a `startsWith` prefix test
  (both raw and resolved forms already checked); 259 resolves the settings-file write target to
  follow symlinks. Neither is compared against a recorded/derived Kosmos path. Self-resolutions.
- **engine/discover.js 1166/1289** -- byFile DEDUP keys, not recorded-vs-ondisk compares. #2408
  deliberately switched the DIR side to physical identity (dev+ino, `seenDirs`) precisely because
  realpathSync preserves case; the loose-FILE side is intentionally left on realpathSync (the
  case-variant root re-walk is already collapsed upstream by seenDirs, and realpath is load-bearing
  to collapse a symlinked .md reached two ways). 1289 is the #2410 Gemini merge, same pattern.

### Other engine sites checked (not in the card, LEAVE)
- **engine/workerfile.js 140-141** -- symmetric realpath containment ESCAPE guard; a case-divergent
  in-folder file reads as refused (safe non-match direction). Tightening a security guard toward
  canonicalOnDisk is optional, not required, and would only loosen it.
- **engine/status.js 75/80** (sandboxIsInconsistent) -- fixture-only tmp-root guard, not a
  recorded-vs-ondisk compare.
- **engine/projects.js 446** -- already prefers realpathSync.native (the canonicalOnDisk primitive).
- **engine/status.js 3177/3186** (readTranscriptDir) -- already uses trust.canonicalOnDisk.

## Bottom line
One fix (codexsession.forWorkdir), everything else correctly leaves. The sweep's value is as much
the documented LEAVE verdicts as the one fix: the next person who greps realpathSync in engine/ has
the per-site reasoning here rather than re-deriving it.
