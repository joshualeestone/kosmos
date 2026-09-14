# #3088: inter-process lock trust.js config/settings/record writers

Follow-up to #2808 class-1 (a). trust.js's writers are read-modify-write + atomic rename with no
inter-process lock, so a restart storm (many default-account agents restarting via #2808's
every-launch re-apply of trustFolder + preacceptBypass) can lost-update the same ~/.claude.json /
settings.json. Splinter assigned: file + build now while the context is fresh.

## The change (wrapper approach - inner bodies UNCHANGED)
- `const { withFileLock } = require('./filelock');` (the fleet's mkdir-atomic lock; chat.js +
  sendertoken.js already use it).
- Shared `configTarget(opts)` + `settingsTarget(configDir, agentDefaultAccount)` helpers - one
  derivation of each writer's target, reused by the lock wrapper + the inner + folderTrusted.
- Each writer: body renamed `<name>Inner`; a thin public wrapper locks the writer's TARGET FILE and
  UNWRAPS withFileLock's `{ok, value}` envelope. Wrapped: trustFolder + forgetFolder (CONFIG),
  preacceptBypass (SETTINGS), recordWrite + dropRecord (RECORD). folderTrusted read-only (no lock).
- Wrappers mkdir the target's PARENT before locking where the inner creates it lazily (the lock
  `<target>.lock` precedes the inner's own mkdir): trustFolder (createIfAbsent), preacceptBypass,
  record writers.

## Two traps hit + fixed (see the commit messages)
1. withFileLock returns `{ok:true, value: fn()}` (an envelope), not fn's result - wrappers unwrap.
2. The lock is `<target>.lock`; its parent must exist or mkdir fails - wrappers mkdir the parent
   before locking for the create-capable writers.

## Tests
- trust.test.js: 39/39 (existing single-process contract preserved).
- ensure-launch-trust.test.js: 5/5 (exercises the wrapped trustFolder + preacceptBypass).
- NEW engine/trust-lock-3088.test.js: N=12 real concurrent child processes trust distinct folders
  against one shared config; all succeed + all keys survive. HONESTLY SCOPED in its header: an
  integration smoke test of the locked path (catches unwrap / parent-dir / deadlock regressions),
  NOT a guaranteed-red lost-update control (that loss is timing-dependent and trust.js exposes no
  seam to force the read/write overlap).

## Scope decision
Locked ALL config-family writers, not just the two on the #2808 hot path: forgetFolder writes the
SAME CONFIG file as trustFolder and must serialize with it; record writers share RECORD. Weakest
premise: the concurrency test is not guaranteed-red, so the cross-process serialization rests on the
single-process tests + the lock primitive's own tests (filelock.test.js) + the mechanism argument,
not on a red-capable end-to-end control. A follow-up could add a delay seam to trust.js for a
deterministic control.

Full challenge-loop before PR. `Addresses #3088` (non-closing).
