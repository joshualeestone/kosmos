# supervisor-env-test: #587, the -e forwarding gets a test that can fail

## Finished looks like
`node --test engine/create.test.js` fails when the `-e` forwarding of any of
KOSMOS_PORT, CLAUDE_CONFIG_DIR or CODEX_HOME is removed from the supervisor's
loop (proven by removing it), and passes with it present. The witness under
tools/ fails against the pre-#586 supervisor and passes against main.
The array that carries the pane's environment is named for what it holds.

## Why
#586's guard was `assert.match(script, /for _var in .../)`: a match against the
script's own source text, green on any build containing the line. The stubbed
suite was green throughout the bug it now claims to guard.

## Changes
1. `engine/create.test.js`: `runLauncher` takes `env` (undefined removes a
   key, so the unset case is testable on a machine whose own
   CLAUDE_CONFIG_DIR is set) and records new-session's argv with boundaries.
   New test: set (a path with a space arrives as one argument, exactly three
   `-e`), unset and empty (no `-e` at all). The text match is replaced by a
   pointer to it.
2. `bin/agent-supervisor.sh`: PORT_ENV renamed PANE_ENV.
3. `tools/witness-pane-env.sh`: the live witness, real tmux, private socket,
   exit 1 on the wrong account.

## Not in this change
The #586 feature itself, the accounts UI, anything in engine/.
