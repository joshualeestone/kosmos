# grokcursor-4446: grok agents stop loading the person's Cursor setup (follow-up to #4430)

Found by Angel on #4446: Grok still reads ~/.cursor/rules/*.md by default (GROK_CURSOR_RULES_ENABLED). #4430 turned off only the Claude cells. Owned by me as #4426/#4430's author (Splinter, 20:13).

## Call
- Turn off all FIVE [compat.cursor] cells (hooks, agents, rules, skills, mcps), not only rules. Grok documents all five, env > config.toml > default on, and the class is "the person's other agent setup", not one cell.
- Same two launch sites as #4430: the Mac supervisor's grok arm, and win32keyed.turnEnv.
- The shared list is renamed from GROK_CLAUDE_COMPAT_OFF to GROK_COMPAT_OFF: it is no longer only Claude's, and a name that says Claude would be false.
- [compat.codex]: its cells are documented as reserved and inert, with no environment variable name, so there is nothing to set. Recorded, not guessed.

## Measured (grok 1.0.41, a SANDBOXED HOME with a fake ~/.cursor, so the real home was not touched)
- Under #4430's env: 2 live [cursor] entries, the person's rule file and a skill.
- With the five cursor cells off: 0 live [cursor].
- Control: live [claude] stays 0.

## Tests
- create.test.js: the Mac launch's -e list equals GROK_COMPAT_OFF, and every cell of both vendors is present.
- win32keyed.test.js: the turn env carries all five cursor cells.
- 3296: the prefix pin now follows the last vendor-compat flag.
- 255/255. Mutants: the supervisor drops cursor rules (red), the JS list drops cursor skills (red, 2).

## Disclosure
- In the first measurement attempt I ran `mkdir -p ~/.cursor` in the REAL home by mistake. It did not exist before (created 20:13, empty) and I removed it at once with rmdir. Nothing else touched it.
