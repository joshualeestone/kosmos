# win32-update-rollback-3017 -- S5 pre-challenge proof

Branch `win32-update-rollback-3017`, head `4c1ba37b`, merge-base `43035808` (origin/main).
Issue #3017 (Addresses, not Closes). Plan:
`.claude/plans/win32-update-rollback-3017-20260914T021812Z.md`.

## What S5 is
The user-facing "Roll back" button (design §5, Josh decision 4). A rollback IS a forward
update whose "staged build" is the kept previous build: `win32update.rollbackToPrevious`
renames the kept `previous-<old>` folder to `<WORK>\staged`, writes a journal marked
`rollback:true` (`from`=current, `to`=old), and starts the SAME detached helper
(`--kosmos-update-apply`), reusing the entire H1-H9 apply/rollback machinery
(stop → move current to `previous-<current>` → move kept into ROOT → interpreter/pointer →
confirm the OLD identity; on failure H8 restores the current build). The only behavioural
delta the helper needed was `applyRefusal`'s never-downgrade gate: skipped for a rollback,
replaced by `newer(from, to)` so it can only ever move to a strictly-older kept build.

## Convergence across 3 review rounds

**Round 1 — SAFETY (kept-build loss on the non-crash paths).** An interrupted or reversed
rollback deleted the kept build (a rollback's `staged` is the ONLY copy of it, unlike a
forward update's re-downloadable download). Fix: `win32apply.moveStagedToKeptPrevious` moves
`staged` → `previous-<to.version>` wherever a rollback journal is finished without a
successful swap — `finishWithoutChange` (crash-at-staged/stopping via
`recoverAtBoot`/`resumeJournal`, and `abandonStagedJournal` on a failed helper spawn) and
`cleanupAfterRollback` (a reversed H8). Plus FIX 2 (honesty, see below), and FIX 3 deferred.

**Round 2 — the finished-journal crash window.** `concludeRollback` saves the journal
`finished` BEFORE `cleanupAfterRollback`→`moveStagedToKeptPrevious` runs, and both resumers
bail on a finished journal. So a crash between `save(finished)` and the preserve rename — or a
preserve rename that throws on a held handle in `finishWithoutChange` — orphaned the kept
build in `staged`, and the next `prepare` deleted it. Fix: `win32update.adoptOrphanedRollbackBuild`
runs in `prepare()` and `rollbackToPrevious()` BEFORE the unconditional `rmSync(staged)`; if a
FINISHED rollback journal names a `to.version` and `staged` is a complete build of exactly that
version (validated with `keptBuildRefusal` + an `app/package.json` version match), it re-homes
`staged` → `previous-<to.version>` instead of deleting it. Cheap in the common case (returns
before any validation when there's no journal or a finished FORWARD journal, so no `node` runs).

**Round 3 — CONVERGED.** Both crash windows closed; the fix is crash-safe, idempotent, dup-safe,
correctly guarded, and free in the common case. The 3 remaining observations are optional/non-
blocking and are documented in the PR body's "Known limits / accepted residuals" (no code change).

## The layered kept-build guarantee
*The kept build is preserved on every finish path, and an orphaned `staged` from a finished
rollback is adopted on the next operation, so it survives a crash at any point; and no path is
ever a TOTAL loss — ROOT always stays bootable (a failed rollback returns you to the current
build via H8; an interrupted one boots the unchanged pointer at logon).*
- `finishWithoutChange` preserves BEFORE marking the journal finished — crash-safe there, idempotent.
- `cleanupAfterRollback` (reversed H8) preserves instead of deleting `staged`, but runs AFTER the
  journal is saved finished — that window (and a throwing preserve rename) is the round-2 gap.
- `adoptOrphanedRollbackBuild` is the backstop: the next prepare/rollback re-homes the orphan.
- All moves are dup-safe (an existing `previous-<to>` drops the duplicate rather than clobbering).

## FIX 2 (honesty)
`update.js` tracks `inFlightKind` ('update'/'rollback'); `/api/update` and `/api/update/rollback`
idempotent `already` responses name the ACTUAL in-flight operation, so an Update press never
claims a rollback is under way (or vice versa).

## Tests + revert controls (each hand-edited RED, then restored)
- `engine/win32apply.test.js`: rollback happy path (OLD identity confirmed, `previous-<current>`
  kept); H8-fail restores current + preserves the kept build; crash-at-`staged`/`stopping` preserve;
  duplicate-`previous-<to>` no-clobber; a throwing preserve still finishes + leaves `staged`;
  never-downgrade skip only for strictly-older; non-boolean flag unreadable; forward journal
  byte-compatible.
- `engine/win32update.test.js`: `rollbackToPrevious` stages+spawns a rollback journal; no-kept-
  previous / incomplete / node-won't-run refusals; spawn-failure rename-back+abandon; live-gate
  throw; `keptPreviousBuild` newest-older-only + realpath-throws host-independence; **round-2
  adopt** (orphaned staged adopted on next prepare) + a finished FORWARD journal never adopts.
- `engine/update.win32-rollback-3017.test.js`: `rollbackOffer` states; `beginRollback` context /
  shared single-flight / refusal-throw release+record / witness; `inFlightKind`.
- `web.update-settle-win32.test.js` + `web.win32-update-offer.test.js`: rollback confirm/overlay/
  settle wording; the Roll back button paint; route/caller one-derivation pins incl. `inFlightKind`.
- Revert controls proven red: never-downgrade skip; `finishWithoutChange` preserve; adopt backstop.
- `engine.reachable.test.js`: the new `setWindowsRollback`/`setKeptPreviousBuild` seams excused;
  `inFlightKind`/`rollbackToPrevious`/`keptPreviousBuild`/`writeRollbackJournal` are reachable.

## Suite results (on-box, INLINE, runtime node v24.19, schtasks-guard preload, scratch APPDATA)
- `engine/win32apply.test.js` (real shims, blocking): 110 tests, 110 pass, 0 fail, 0 cancelled.
  origin/main baseline: 101 pass, 0 fail (delta = +9 host-independent S5 tests, all green).
- `win32update` + `update.win32-rollback-3017` + `web.win32-update-offer` + `web.update-settle-win32`
  + `engine.reachable`: 0 fail (1 `KOSMOS_WIN_ZIP_SAMPLE` skip).
- Both browser-check gates green on-box: coarse #1720 exit 0, surface #2518 exit 0.
- Schtasks block log empty on every run. The only tree-wide failure is the pre-existing
  environmental `browser-checks-reason-grep.test.js` ("could not run the real grep"), identical
  name+reason on branch and origin/main (node cannot spawn `grep` on this box; file unchanged here).

## diff_hash
    git diff 43035808..HEAD -- . ':(exclude).claude/plans/win32-update-rollback-3017-proof-*.md' | sha256sum

merge-base `43035808`, head `4c1ba37b`:

    diff_hash = 5f7e85fe884440298de1cd5529516ed0e9fc4f45231d62db071809b03195b631

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anwz2k5SbPCSy3yNnPQEok
