# Proof — win32-launcher-downgrade-guard-3016 (#3016)

## Convergence

- **Round 1: NO must-fix defects.** Coordinator review found the change correct.
- **The critical check — does the downgrade guard break the S5 update rollback? — VERIFIED CLEAN.**
  A version update's rollback is a *legitimate* downgrade (N+1 → N), so it must NOT be
  refused. It is safe because the updater repoints `engine-path` **directly**, never
  through `win32anchor.ensureAnchored`:
  - `engine/win32apply.js` step H6 writes the pointer via `win32swap.writeFileAtomic`
    (grep: `win32apply.js`/`win32update.js` contain zero `ensureAnchored(` calls).
  - So the guard (which lives inside `ensureAnchored`) cannot fire during a rollback.
  - The post-rollback boot re-anchors with `engineDir === pointer` (the rolled-back
    engine the pointer now names), which short-circuits before the version compare.
- **Two cheap improvements taken:**
  1. **Lock test** pinning the invariant the whole safety argument rests on — that the
     updater/rollback repoints without `ensureAnchored`
     (`engine/win32anchor.downgrade-3016.test.js`, "LOCK: the updater and its rollback
     repoint the pointer WITHOUT ensureAnchored"). If a future refactor ever routed a
     rollback's pointer write through `ensureAnchored`, this reds; no other #3016 test
     would have caught it.
  2. **Invariant comment** at `win32handoff.decideHandOff`'s downgrade branch documenting
     `ensured.downgrade ⟹ (win32 ∧ bundle ∧ live-armed)` (set only by
     `ensureInstalled`, which gates platform/bundle at its top and in production runs
     only from server.js's live-armed real-startup path), so a future loosening of the
     downgrade-set condition cannot silently call `status()`/`runNow()` unarmed.
- **Also verified clean by review:** fail-open behaviour, `handOffToNewer`, version edges
  (equal/newer/first-install/repair), and state consistency.

## Tests / controls (on-box; node = %LOCALAPPDATA%\Kosmos\runtime\node.exe; schtasks
preload armed; scratch APPDATA/LOCALAPPDATA)

- New host-independent suites (green on macOS CI: real temp dirs + injected platform/seams):
  - `engine/win32anchor.downgrade-3016.test.js` — older refused + pointer intact; first
    install; newer-forward; same-version repair re-points; unreadable fails open; the LOCK test.
  - `engine/win32board.downgrade-3016.test.js` — ensureInstalled reports downgrade, no
    `/Create`, no claim; control: a not-older build still registers.
  - `engine/win32handoff.downgrade-3016.test.js` — leave the newer board; `/Run`-then-leave;
    PORT-override keeps to launcher; fallback; `end` never called.
- **New files: 12 pass** (incl. LOCK). **Affected win32 set (9 files): 187 pass, 0 fail.**
  Extraction harnesses (win32update/win32swap/win-launcher-native): 155 pass, 1 skip.
  `win32apply.test.js`: 110 pass. update/reachable/identity/platform-gate: 43 pass.
- **Revert control:** hand-editing `wouldDowngradePointer` to always return false reddened
  exactly the "OLDER build is REFUSED" detection test (pointer would downgrade); restored
  by hand-edit, tree clean.
- **`engine/machine.test.js`:** 25 fail in worktree vs 26 fail on a `git archive` of
  origin/main; `Compare-Object` of failing-name lists → **zero** failures in mine that are
  not in the baseline (pre-existing macOS-gated checks on this Windows box; not this change).
- **Block log empty** across all runs — no real `schtasks` attempted; live board/tasks untouched.
- **No `web/index.html` / `/api/status` / `KosmosLauncher.cs` change** → browser-check,
  status-field, and launcher-rebuild gates do not apply.

## diff_hash

- merge-base(origin/main, HEAD) = `21b4b2315ab055b391e298526d6b88e0594f8a84`
- Command:
  `git diff 21b4b231..HEAD -- . ':(exclude).claude/plans/win32-launcher-downgrade-guard-3016-proof-*.md' | sha256sum`
- **diff_hash = `5f2d78bb12936f2b9747b239f105a6d2b860a340090d67166fb09c6595346a7a`**

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anwz2k5SbPCSy3yNnPQEok
