# account-probe-explicit-3189 -- create-gate default probe uses explicit dir

## Context
kosmos#3189 is the umbrella sweep: the board runs as a com.kosmos.board launchd job with
NO ambient shell env, so any resolver that leans on ambient env (an unset CLAUDE_CONFIG_DIR
resolved by the tool's own default logic, an ambient bin path) fails. The fix class is
explicit resolution. Known instances: #3113 (tmux), #3136 (check-now badge), #3188 (tmux
folder). This branch is MY subset: account/claude-probe resolvers.

## The one real instance in my subset: the create gate (#4)
`engine/create.js` `accountConnectable` probes the account's Claude credential via
`claudeAccountLive`, which makes a real `claude -p` call. It scoped the default account as
`claudeAccountLive(acct.isDefault ? null : acct.dir)`. For the default, `null` deletes
CLAUDE_CONFIG_DIR and leans on `claude -p`'s ambient default resolution -- which fails in
the board's launchd process -> UNKNOWN. Here it fails OPEN (create still proceeds), so it
is benign, but it is the same launchd-missing-ambient-env class as #3136 and #3113.

**Fix:** pass the resolved dir explicitly for the default too: `claudeAccountLive(acct.dir)`.
`acct.dir` is the env-resolved `<homeDir>/.claude` (accounts.js, via AGENT_WORKFORCE_HOME ||
os.homedir()), so it is env-independent -- the same explicit-resolution pattern as #3136/#3113.

## The subcommand-dependent nuance (why this is NOT a uniform "isDefault ? null" fix)
The sweep also flagged `server.js:4185` (subscription.checkLive, the per-agent account-status
route #1885) as a candidate. It was BOARD-REPRO'd and WITHDRAWN -- it is NOT a bug:
- Live prod board: the default's checkLive (no configDir, via accounts.listLiveNow) returns
  state=connected under the real launchd process.
- accounts.js:331-345 (measured): the default's real config is the `<homeDir>/.claude.json`
  FILE beside the dir; `CLAUDE_CONFIG_DIR=<homeDir>/.claude` makes `claude auth status` read a
  DECOY `.claude.json` inside the dir and report not-signed-in. So checkLive's default arm MUST
  use UNDEFINED. Passing the dir there would REGRESS ("tell a paying customer they're not
  connected").

=> The correct configDir for the default is SUBCOMMAND-DEPENDENT:
   - `claude -p` (claudeAccountLive, the create gate): default needs the RESOLVED DIR.
   - `claude auth status` (subscription.checkLive): default needs UNDEFINED.
A guard comment at the create-gate fix names this so nobody re-adds a uniform fix in either
direction. Full sweep + retraction on the kosmos#3189 card.

## Change
- `engine/create.js`: `claudeAccountLive(acct.isDefault ? null : acct.dir)` -> `claudeAccountLive(acct.dir)`, with the #3189-instance-4 comment + the subcommand-dependent "DO NOT unify" guard.
- `engine/create.account-connectable-1903.test.js`: re-anchor test #179 from the old buggy "default checked with NO configDir (null)" contract to "#3189: default checked with its RESOLVED dir". Stub dead ONLY for the resolved default dir; a `sawConfigDir === DEFAULT_DIR` assertion is the NEGATIVE CONTROL. Proven armed: reverting the fix reds it (13/1), fix restored -> 14/14.

## Scope / non-goals
- Does NOT touch server.js:4185 / checkLive / listLiveNow (board-confirmed correct).
- Does NOT touch the launch/run-contract sites (create.js job-config, server.js:9061 connect.start) -- null-for-default is the deliberate run contract there.
- win32*.js CLAUDE_CONFIG_DIR handling is Angel's board-infra lane -- noted on the #3189 card for her fresh session, not touched here.

## Test plan
- `node --test engine/create.account-connectable-1903.test.js` -> 14/14 (the re-anchored #3189 test green with the fix, red without it -- negative control proven).
- Full validation suite (challenge-loop 6.0/6j). Run isolated (board-port EADDRINUSE + real-claude-probe timeouts are environmental flakes under concurrent load).

## Weakest premise
That `claude -p` for the default under launchd is fixed by passing the resolved dir -- proven
by #3136's board confirm (the check-now default greened after the identical explicit-dir change).
The create gate fails OPEN, so even if wrong the blast radius is a benign UNKNOWN, never a false block.
