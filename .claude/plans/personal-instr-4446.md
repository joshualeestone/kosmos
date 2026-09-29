# personal-instr-4446: tell the person when an agent also loads their personal instructions file

Card: joshualeestone/kosmos#4446 (found in the #4424 dress rehearsal). Claimed by Angel 2026-09-28.

## Finished looks like
Opening an agent's Instructions panel shows one sentence when that agent's own CLI will also load
a personal instructions file from outside the agent's folder, naming the tool and never the path or
text; no sentence when there is none; the sentence never carries over to another agent.

## Decision (recorded on the card, 19:50 and 19:58 CDT)
- KEEP the inherited file and SAY SO. Kosmos does not add it; each CLI reads its own user-level file.
  Stripping has no narrow switch for Claude (`--setting-sources project,local` also drops the user's
  settings.json; a separate config dir moves the keychain login), and on the dev Mac every fleet
  agent's rules live there.
- Grok importing the person's CLAUDE.md (the least defensible part) is already turned off on main by
  #4426 (41e887303). This change reports Grok's OWN `<GROK_HOME>/AGENTS.md` only.
- `kosmos agents` listing every agent is the verb's design (no arguments, board-wide). Not filed.

## Scope
- engine/personalinstr.js: `personalInstructions(name)` -> `{ tool }` or null. Runner from the job
  (readJob) else the profile (recordedRunner); config dir from the job. `filesFor` lists what each
  CLI loads, read from its own code or bundled docs on this Mac (2026-09-28): Claude
  `<CLAUDE_CONFIG_DIR or home/.claude>/CLAUDE.md`; Codex `<CODEX_HOME>/AGENTS.override.md` or
  `AGENTS.md` (the binary); Gemini `<storage home>/GEMINI.md` (`getGlobalMemoryFilePath` in its
  bundle); Grok `<GROK_HOME>/AGENTS.md` and every `*.md` directly in `<GROK_HOME>/rules/` (its
  embedded docs). Any one regular non-empty file, symlinks followed. Antigravity and Muse: null.
  Never throws.
- server.js: the instructions GET adds `personal`.
- web/index.html: `#d-instr-personal` under the lede; `paintPersonalInstr`; hidden at load start and
  in the agent-switch reset loop.
- Tests: engine/personalinstr.test.js (7); browser check render-personal-instr-4446 (real server read,
  CONTROL arm, a failing-read arm measured red by removing the reset). Indices: gated.txt, README,
  reason-grep count 199 -> 200 (measured).

## Weakest premises
- A file renamed in the CLI's own settings (Gemini `contextFileName`, Codex
  `project_doc_fallback_filenames`) is not seen, so the panel says nothing in that case.
- Grok by default also reads `~/.cursor/rules/*.md` (`compat.cursor.rules`), which #4426 did not
  turn off. Noted on the card for #4426's owner; this panel does not report it.
- The copy ("They also follow your personal <tool> instructions, which are kept outside Kosmos and
  apply to your other <tool> sessions as well.") is mine; Mona owns the panel's wording and may
  reword it.
