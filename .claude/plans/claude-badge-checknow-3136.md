# claude-badge-checknow-3136 -- the Claude account badge greens after Check now on the DEFAULT account

Kosmos #3136. Josh 6.70-verified: a connected Anthropic/Claude account reads "Signed in"
but the status dot never greens after "Check now" -- it stays neutral. His primary
account is the default one.

## Root cause (reproduced server-side on the served 0.6.70 board, verified by content)
The badge-green MECHANISM is correct: for a LABELED account (CLAUDE_CONFIG_DIR set to
its dir), Check now -> {state:connected} -> the badge flips to `working` (green), live.
The bug is the DEFAULT-account probe: the check-now handler scopes the default by
DELETING CLAUDE_CONFIG_DIR (`probeDir = acct.isDefault ? null : acct.dir`), so `claude
-p` does its OWN ambient default resolution -- which fails in the board's launchd
process (com.kosmos.board lacks the ambient shell env) -> a fast non-zero exit (~4-5s,
not the 15s timeout) -> claudeAccountLive returns UNKNOWN -> the handler records nothing
-> the badge stays signed_in_unverified (neutral). Same launchd-missing-ambient-env
class as #3113/#3188 (meta sweep #3189; the create-gate is instance #4, deferred there).

## Change
- **server.js** (check-now handler `POST /api/accounts/claude/check`): pass the
  account's RESOLVED dir explicitly for the DEFAULT too (`probeDir = acct.dir`), instead
  of null/ambient. `acct.dir` is accounts.js's env-resolved `<homeDir>/.claude`, so the
  probe no longer depends on the launchd process's ambient env -- the same explicit-
  resolution pattern as #3113's merged bundled-tmux fix (resolve upstream, pass
  explicitly, don't trust the tool's ambient env). Keyed by acct.dir for the badge join,
  as before, so the default reaches the right badge.
- **engine/create.js** (`claudeAccountLive(configDir, opts)`): a scoped `opts.diag` that,
  on the UNKNOWN return, logs the otherwise-discarded probe output so the board names the
  failure. Inert for the create gate (passes no opts), so its frequent fail-open stays
  quiet. SHIP-then-STRIP: removed once the board confirms the default greens.
- **engine/server.badge-observed-1921.test.js**: the `#3136 ROUTE` default test encoded
  the OLD null-scoping using a fake probe that IGNORES configDir -- it asserted the buggy
  behavior and could never return the dangerous answer. Re-anchored to the new contract
  (the default probes with its resolved dir, not null). This is the more important half.

## Scope (deliberate)
- Fix is scoped to the check-now/badge path. The create gate has the same latent default-
  probe failure but FAIL-OPENS (creates still work), so it is benign and left OUT of this
  PR, tracked as #3189 instance #4 (mine). Widening a badge fix into the working create
  path is unwarranted risk (Splinter concurred).
- NOT a launchd-plist env patch (fragile: fixes today's vars, breaks on the next ambient
  read). Explicit resolution is correct regardless of launch context.

## Verify
- Unit: badge-observed + observed suites green (a fake probe CANNOT reproduce the launchd
  failure, so units assert the CONTRACT; the real green is the live board).
- Board (launchd): on a board-as-launchd, POST check on the default account -> {state:
  connected} + badge `working`. Routed like #3113/#3191's fresh-Mac verify; the shipped
  diag confirms on the 6.71 deploy, then a follow-up strips it.

## Depends on / relation
- Rebased onto merged main including #3113 (#3191). Sibling launchd-env fix; shares the
  explicit-resolution pattern, different resolver (config-dir vs installedRoot).
- Not auth-surface (#874): normal review, not Pete-gated. 6.71 cut.
