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
- The MESSAGE-BEARING writers (trustFolder, forgetFolder, preacceptBypass) use `withWriteLock`, which
  runs the inner UNLOCKED when the target parent does not exist, so on a mkdir-failed / locked-down
  home the inner's specific refusal ("we could not write to their settings file", etc.) is surfaced
  rather than masked by the lock's generic "we could not get exclusive access". The record writers
  (recordWrite -> bare boolean, dropRecord -> void) carry NO specific message to mask and their inner
  can throw on an absent parent, so they deliberately keep raw `withFileLock` (a lock failure degrades
  to the same false / no-op they already promise) - see their comments.

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
Locked ALL config-family writers, not just the two on the #2808 hot path: forgetFolder writes
CONFIG() and record writers share RECORD, so each must serialize against any other writer of its own
file. Weakest premise: the concurrency test is not guaranteed-red, so the cross-process
serialization rests on the single-process tests + the lock primitive's own tests (filelock.test.js)
+ the mechanism argument, not on a red-capable end-to-end control. A follow-up could add a delay
seam to trust.js for a deterministic control.

## Two limitations the lock does NOT close (documented, not bugs introduced here)
1. forgetFolder / trustFolder do NOT always serialize against EACH OTHER. Each locks its own inner's
   target correctly, but the targets can differ: trustFolder honors opts (a default-account agent,
   agentDefaultAccount + no configDir, targets defaultAgentConfig() = ~/.claude.json) while
   forgetFolder takes no opts and always targets CONFIG() (the engine's own config, which follows
   the engine's CLAUDE_CONFIG_DIR). So for a default-account agent on an engine that carries
   CLAUDE_CONFIG_DIR, trustFolder and forgetFolder act on DIFFERENT files - a pre-existing
   forgetFolder-ignores-opts divergence (rollback operates on the wrong file for that agent),
   neither introduced nor fixed here. The lock is still keyed correctly per writer, so no new bug;
   the earlier code comment overstating "same file" was corrected to claim only per-file
   serialization.
2. The lock is best-effort with a bounded acquire wait (filelock.js LOCK_WAIT_MS = 2000ms). Under a
   large enough restart storm, if agents contend on one <config>.lock for >2s the wrapper
   fail-safes to {ok:false} and the trust/settings write is SKIPPED. That degrades to the ORIGINAL
   single-agent symptom (an agent meets the trust prompt), NOT to a corrupted / lost-update config -
   the whole point of the lock. This skip-under-heavy-contention is the accepted worst case; the 2s
   budget bounds how large a simultaneous storm the lock absorbs cleanly. A larger budget or a retry
   loop is a follow-up if real storms are observed exceeding it.

Full challenge-loop before PR. `Addresses #3088` (non-closing).
