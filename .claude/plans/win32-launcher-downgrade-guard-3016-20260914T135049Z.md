# win32-launcher-downgrade-guard-3016 — guard against a double-clicked older Kosmos.exe downgrading the fleet

Addresses #3016. Base: `origin/main` `21b4b231`.

## The defect (design §0 finding 2, §6 Q7)

On Windows the shipped bundle is a portable zip. `KosmosLauncher.cs` always runs
its own folder's `app/server.js`. That boot calls
`win32board.ensureInstalled()` → `install()` → `win32anchor.ensureAnchored()`,
which unconditionally rewrites the shared `engine-path` pointer (and the
supervisor/board boot shims, and the anchored `node.exe`) to THIS folder's engine.
The pointer is the ONE indirection every registered Scheduled Task reads at logon
and every agent supervisor reads at start, so rewriting it moves the whole fleet.

Therefore double-clicking an **older** unpacked `Kosmos.exe` silently downgrades
the running fleet: the next board restart / logon / agent-create runs the older
engine. Worse, the #570 hand-off (`win32handoff`) would then `/End` the running
newer task board and `/Run` the task, which re-reads the just-downgraded pointer
and brings the OLDER build up as the fleet board.

Josh's decision (memory windows-updater-decisions #6): "Never downgrade. Opening
an older Kosmos.exe must not take over the fleet. Hand off to, or update to, the
newest copy instead."

## Chosen behavior: refuse the downgrade at the pointer, then hand off to the newer copy

Two coordinated parts:

1. **The fleet guard (the real fix), in `win32anchor.ensureAnchored`.** Before it
   rewrites anything, read the existing `engine-path`. If it names a *different*
   engine whose bundle **version** is strictly newer than the engine being
   anchored, do nothing at all — no pointer write, no node.exe copy, no shim
   rewrite — and return `{ ok:true, downgrade:true, ... , keptEngine }`. This is
   the airtight guard: it stops the downgrade no matter which caller
   (board boot, agent create, a future updater) reaches it.

2. **The UX, via the existing #570 hand-off.** `install` and `ensureInstalled`
   propagate `downgrade:true` (skipping the board-task re-register and the
   board-boot shim rewrite too — those on-disk shims were written by the newer
   build and must not be clobbered by the older build's constants).
   `handOffToTask`, seeing `ensured.downgrade`, runs a **serve-the-newer-instead**
   path: if a board already answers on the port (the newer fleet board, which the
   un-downgraded pointer still names) it leaves it be and exits 0 ("A newer
   version of Kosmos is already running. Your browser is opening it."); if none is
   up it `/Run`s the task (guarded pointer ⇒ starts the newer build) and leaves.
   It NEVER `/End`s or replaces the running board on the downgrade path.

Why hand-off (not update-forward, not a bare message): the newest build is already
installed and anchored, so "hand off to the newest copy" is the exact,
already-built serve-here / task path. There is no newer zip to fetch, so
"update forward" is not applicable here; the S2/S4 in-app updater already refuses
a not-newer *download*. A bare message would leave the person's double-click doing
nothing visible; handing the browser to the running newer board is what they want.

## Version comparison — reuse, do not reinvent

- Numeric compare: reuse `update.newer(a,b)` (strict x.y.z numeric; unknown ⇒ not
  newer). Required lazily inside the guard (win32-only path; keeps module load
  cheap; cycle-safe — update.js requires none of the win32* modules).
- Version read: reuse `win32handoff.buildIdentity(appDir)` (the one derivation of
  "which build a bundle is"), take the version half (before any `+sha`). Required
  lazily. Same-version-different-sha is treated as **equal, not a downgrade**
  (git shas are unordered; a same-version repair/reinstall must still work).
- `appDir` for an engine dir `<root>/app/engine` is its parent `<root>/app`.

## What still works (preserved)

- **First install** (no existing pointer) → `newer(anchored, launched)` with a null
  anchored version is false → normal write.
- **Equal or newer** launched build → not older → normal write (a newer Kosmos.exe
  double-click legitimately moves the pointer forward = "update to the newest").
- **Same-version reinstall/repair** → equal version, and an identical engine dir
  short-circuits first → normal write.
- Unreadable version on either side → fail-open to today's behavior (matches
  `newer()`'s unknown ⇒ false posture; documented).
- A board started **by its task** runs the anchored engine, so its engineDir equals
  the pointer ⇒ never a downgrade. Only a hand-started OLDER build trips the guard.

## Files

- `engine/win32anchor.js`: the guard in `ensureAnchored` + a private
  `wouldDowngradePointer()` helper (reuses `update.newer` + `buildIdentity`).
  Return shape gains optional `downgrade`/`keptEngine` (additive).
- `engine/win32board.js`: `install()` short-circuits on `anchor.downgrade`;
  `ensureInstalled()` returns `action:'left-newer', downgrade:true` (additive).
- `engine/win32handoff.js`: `handOffToTask` downgrade branch → new
  `serveNewerInstead()`; honors a launch override (keeps its own window) since the
  pointer guard already protects the fleet. `buildIdentity` unchanged (reused).
- `server.js`: one win32-gated stdout line explaining nothing installed (minor).
- Tests: `engine/win32anchor.downgrade-3016.test.js`,
  additions to `engine/win32board` and `engine/win32handoff` suites. All
  host-independent (real temp dirs + injected platform/env/seams); schtasks stays
  stubbed; no `/api/status` or `web/index.html` surface touched (no browser-check
  / status-field gate in play).

## CI portability

Numeric compare via `update.newer`; all path logic through node `path`/`fs` on real
temp dirs with injected `platform`; tests green on macOS CI (host-independent).
Shared functions reused, not re-signed; new return fields optional + null-safe;
GREP+run every suite that evals win32anchor/board/handoff in the comparison.

## Test / revert plan

Run via PowerShell + `C:\Users\joshu\AppData\Local\Kosmos\runtime\node.exe`, with the
schtasks preload and scratch APPDATA/LOCALAPPDATA. Compare failing NAMES and first
error lines against a `git archive` of origin/main; revert controls by hand-edit.
