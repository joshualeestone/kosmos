# #2439 - rename the on-disk store dir AgentWorkforce -> Kosmos, with data migration

## Goal
Rename the on-disk store leaf from `AgentWorkforce` to `Kosmos` (the product's real name)
before launch, while it is still cheap, without orphaning any existing install's data.

## Scope (measured, larger than the card's "~20 engine files")
- `engine/store.js` - `APP` is THE constant. `dataRootFor(platform, home, env, app)` builds the
  root (`AGENT_WORKFORCE_DATA/APP`, or win32 `APPDATA/APP`, or mac/linux
  `home/Library/Application Support/APP`). `root()` resolves per-call (lazy, #1443).
- `engine/worlds.js` - a SECOND literal hardcoder (per-world leaf).
- Everything else in `engine/` derives from `store.ROOT` or the `AGENT_WORKFORCE_*` env vars.
- `install/setup.sh` - hardcodes the leaf in the DESTRUCTIVE uninstall rm-guard and in the
  source-channel write.
- `native-app/main.swift` - a SEPARATE language that resolves the same store dir independently
  (board.token, a11y-status, file-access IPC, relaunch handoff). Found during challenge review;
  this is the cross-language seam and the most dangerous miss.

## Design
1. `const LEGACY_APP = 'AgentWorkforce'; const APP = 'Kosmos';`. `dataRootFor(..., app = APP)`.
   `legacyRoot()` = `dataRootFor(..., LEGACY_APP)`.
2. `maybeMigrateLegacyStore()` at the top of `root()`, guarded by a once-per-resolved-root Set:
   - if new === legacy (APP === LEGACY_APP) return; if `existsSync(newRoot)` return (NEVER
     clobber); if `!existsSync(legacyRoot)` return (fresh install); else `renameSync(legacy, new)`.
   - wrap in try/catch, NEVER throw (ENOENT/EEXIST benign; EXDEV leaves legacy intact and the
     person re-signs-in - never data loss).
3. `worlds.js` per-world leaf via `store.APP`.
4. Test sweep: every test that seeded/asserted the LITERAL store leaf derives it from `store.APP`.
5. `install/setup.sh`:
   - uninstall rm-guard accepts BOTH `/AgentWorkforce` and `/Kosmos` leaves for the migration
     window (a migrated install would otherwise abort uninstall). Every existing safety refusal
     (system-Library, non-absolute, no-leaf, `.`/`..`, shell-significant chars) preserved.
   - the source-channel write targets the CURRENT leaf (legacy when it exists and Kosmos does not,
     else Kosmos), so a pre-migration update does not pre-create Kosmos and cause the never-clobber
     migration to skip and orphan the old store.
6. `native-app/main.swift`: a `storeLeaf(base:)` helper returning the CURRENT leaf (same
   legacy-vs-new choice), routed through all four resolvers, so the Swift writers never pre-create
   Kosmos before the JS migration - same orphan-prevention reasoning as the source-channel write.

## Decisions (rationale on the card too)
- Do NOT rename the `AGENT_WORKFORCE_*` env vars - internal harness knobs, not user-facing
  branding, huge blast radius for no user benefit. Separate follow-up if Josh wants it.
- Migration MOVE (rename) when target absent, never symlink, never clobber. Both-exist = keep new,
  leave legacy untouched.
- The uninstall guard's fallback literal stays `AgentWorkforce` - it fires only when the installed
  store.js cannot be consulted (old/odd install), which is exactly the legacy case it should target.
- Every independent writer (JS engine via root(), the installer, the native app) must avoid
  pre-creating the new leaf before the migration runs; the JS engine is self-safe (migrates first),
  the installer and the native app use the current-leaf choice.

## Weakest premise
That the four Swift resolvers plus setup.sh plus the engine literal are the complete set of
independent store-dir writers. Mitigated by grepping every tracked file type (js, sh, swift, md)
for the literal leaf, not just *.js/*.sh (the original recon missed *.swift, which the challenge
loop caught).

## Validation
Full suite (`tools/run-tests.sh`): JS unit tests + the shell test battery, including
`test-a11y-writer-mock-2125.sh` (compiles main.swift and pins Swift-writes == JS-reads on the
leaf), `test-data-root-1511.sh` (uninstall guard), `test-staging-wire-2036.sh` (source-channel).
