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

## Validation (0031b64b): PASSED (11489 tests, 0 fail)

## Review round 1 (opus, blind): 0 BLOCKERs, 2 WARNINGs, 3 NITs; all are comments, no code change
- **WARNING** The docs disagree about codex: the guide says its cells are inert, the reference table says codex hooks and skills are scanned "when present". Recorded in win32keyed.js as a REOPEN condition: only config.toml could turn them off if they go live.
- **WARNING** The 3296 regex no longer checks which cell comes last. KEPT: create.test.js pins the list.
- **NIT** The cursor cells also stop a project's own `<cwd>/.cursor` rules and mcp.json, the same trade #4426 made for `<dir>/.claude`. Now said.
- **NIT** win32keyed.js turnEnv, groksettings.js and create.js described only claude-compat. Updated.
- **NIT** hooks '0' vs 'false' is now explained (#3391 shipped '0' and measured it; the later cells use the documented 'false').
