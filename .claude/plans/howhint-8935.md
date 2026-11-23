# kosmos#8935: the first use of a command with a longer guide names the guide, once per agent

## Finished looks like
The first time an agent runs `kosmos claim`, `task`, `post`, `community`, `connections` or `report` (on a Mac or on Windows), the command prints one line on stderr naming that command's guide (`kosmos <cmd> --how`; for report, `kosmos report --help`). The same agent never sees it again for that guide, and never sees it at all if it read the guide first. A person in their own Terminal never sees it. A command's own output is unchanged.

## Shape (posted on the card, comment 7106272674)
- One engine module, engine/howhint.js: the guide table, the decision and the record (`how-hints.json` in store.root(); KOSMOS_HOWHINT_FILE is a test seam). Never throws.
- install/kosmos: `_how_hint <cmd> "$@"` before the six commands; only an agent's call reaches node; output to stderr; never fails the command.
- tools/windows/kosmos-cli.js: the same call in main() before the handler, through ctx.engine, inside its own try.
- Not on `kosmos task built`: #8934 (Baron) prints its own line naming the task guide there (agreed in the room).

## Rejected
Pointers on specific cases only (first repeating task, first formatted post, first --held): each needs detection in two CLIs, and the plain case has the same risk. Printing on every use: noise.

## Weakest premise
That agents read a command's stderr. Claude Code shows it with the output; a runner that hid stderr would make the pointer silent (nothing breaks).

## Evidence (first build)
- engine/howhint.test.js 5/5 and engine/howhint-cli-8935.test.js 2/2 (the real install/kosmos spawned; the Windows CLI's main()).
- Mutations, each red: the Mac hook removed from claim; the Windows hook removed; the once-only check removed.
- Every Windows CLI test file (40 files): 465 pass, 0 fail. Every node test that spawns install/kosmos as an agent (20 files): 759 pass, 0 fail. tools/test-board-watchdog-2955.sh and tools/test-ssh-keychain-note-2600.sh pass. fixture-discipline and engine.reachable pass.
