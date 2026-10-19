# kosmos#6095: plugin reach reads a default-account agent's REAL Claude folder

## Change
- engine/sessionccd.js `sessionClaudeDirs(names)`: the CLAUDE_CONFIG_DIR each tmux session's new processes run under.
  It reads list-sessions, then in batches of 40 one tmux sequence of the server's global environment plus each
  session's, QUOTED (`show-environment -s`), parsed as a stream. It answers a folder, `''` (the default) or null
  (unknown).
- server.js attachPluginReach (#6092): a default-account Claude card (account.isDefault, runner claude) with a pane
  has its session read.
  - A folder is judged as that folder.
  - `''` is the default, as before.
  - Unknown gives reach UNKNOWN, which the board renders as nothing.
  - A paneless card and Windows keep the account reading.

## Decided
- Unknown, never the default, when:
  - a session has no value of its own while the server has a global value (it may have inherited it);
  - a session removes the variable while the server has a global value (variable names print unquoted and can forge
    a removal);
  - a value is set but empty;
  - the read fails, is malformed, or a marker is missing, repeated or out of order.
- Names tmux reads specially in a target are not asked about (unknown), so they cannot fail a batch.
- Only the pane's own session is asked about, never the sessionName: in a named world that can name another world's
  session.

## Weakest premise
The session environment is what the pane's processes got. That holds for the supervisor's `new-session -e` pin
(measured), but tmux keeps no record of an inherited value that was later removed from the server; that case reads
`''`. Named in the module.

## Evidence
- engine/sessionccd-6095.test.js has 12 tests, including one on REAL tmux on a private socket. That test covers:
  - a value with spaces, quotes and $;
  - a forged entry and marker inside a value;
  - the leak: a global set, then a new session reads unknown;
  - a forged removal through a variable name.
- web.pluginreach-5309.test.js uses the real card shape. server.agent-account-status-1885 takes the account from
  the server's own accountForAgent.
- Mutants: 15 on the module and 6 on the wiring; each reds a test.
- Measured read-only on this machine: 20 sessions read in 12 ms. The one pinned session (echo) matches its own job.
  The server has no global value.

## Review
1. opus: BLOCKER, an inherited global value read as the default; plus batches, forged markers, untested guards.
2. sonnet: a newline in a value forged an entry, which led to the quoted parsing; also bad names and empty values.
3. opus: a newline in a NAME forged a removal; the name pattern was too narrow; shape guards were untested.
4. sonnet: no blocker or warning (slice 1 converged); docstring nits.
5. opus (wiring): BLOCKER, the wiring never ran on a real card (tests typed `{ dir: null }`); plus the sessionName
   fallback.
6. sonnet: no blocker or warning; proved end to end through GET /api/status. Converged.
