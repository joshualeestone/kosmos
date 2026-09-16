# strip-diag-3136 -- remove the temporary #3136 verify diag

## Context
kosmos#3136: the default Claude account badge would not green on "Check now" in the
board's launchd process. Root cause: the check-now handler deleted CLAUDE_CONFIG_DIR
and leaned on `claude -p`'s ambient default-config resolution, which fails under
launchd (wrong/missing HOME) -> fast non-zero exit -> UNKNOWN -> no green. The fix
(PR #3192, merged) passes the account's RESOLVED config dir explicitly for the default
too (`probeDir = acct.dir`), which is env-independent.

That PR also shipped a **temporary diagnostic instrument**: `claudeAccountLive` gained
an `opts` param and, on the UNKNOWN return, a `console.error` gated behind `opts.diag`;
the check-now handler passed `{ diag: '#3136-checknow ...' }`. Its only job was to
surface the discarded probe output on the 6.71 board deploy so we could confirm the
cause was config-not-found (vs something else).

## Why strip now
The default account is **board-confirmed green on the real prod board**:
`signed_in_unverified` -> POST /api/accounts/claude/check on the default dir returned
`{state:connected}` -> badge `working` (observedAgeMs=239). Splinter accepted this direct
board evidence as the confirming arm and directed the strip. The instrument has served
its purpose; it rides the next cut (6.72).

## Change
- `engine/create.js`: `claudeAccountLive(configDir, opts)` -> `claudeAccountLive(configDir)`;
  delete the `#3136 DIAG` comment block + the `if (opts && opts.diag) { console.error(...) }`.
- `server.js` check-now handler: drop the `{ diag: ... }` arg on the `claudeAccountLive`
  call; trim the diag-only comment sentences. **The fix itself (`probeDir = acct.dir`,
  explicit for the default) is UNCHANGED** -- only the temporary instrument is removed.

## Scope / non-goals
- Does NOT revert the #3136 fix. `probeDir = acct.dir` (explicit default resolution) stays.
- Does NOT touch the create-gate probe (that is kosmos#3189, a separate branch).
- No behavior change: the diag was a server-side `console.error` on an error path only.

## Test plan
- No test asserted the diag (grep: zero `opts.diag` / `#3136-checknow` assertions).
- `server.badge-observed-1921.test.js` + `engine/create.claude-probe-1916.test.js` +
  `engine/create.account-connectable-1903.test.js` stay green (35/35), including the
  re-anchored "DEFAULT account probes with its RESOLVED dir (not null)" test that
  certifies the fix is intact.
- Run validation isolated (board-port EADDRINUSE + real-claude-probe timeouts are
  environmental flakes when peers run suites concurrently).

## Weakest premise
That the board confirm greening the DEFAULT account generalizes to Josh's default when
he tests 6.71 -- it is a code-path fix (explicit config-dir resolution, account-agnostic),
so confirming the default path on a prod board confirms it for his default too. Safety
line accepted with Splinter: if 6.71 somehow still shows neutral on his machine, re-add
a diag + hotfix. The strip is not gated on that; direct board evidence is sufficient.
