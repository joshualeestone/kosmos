# codexhook-5812: a Codex agent's file edits record their writer and keep an undo copy (#5812 item 2)

## What
A Codex agent edits files through `apply_patch`. Codex 0.149.1 (the pinned build) runs a PreToolUse hook before it, with
`tool_input.command` = the whole patch text (measured 10-16 against the real CLI and a local fake Responses server; card
comment 6219788459). This change wires that hook to the same board call the Claude and Gemini hooks make
(`POST /api/undo/keep {path, cwd, session}`), once per file the patch names, so:
- the undo switch (#5153) keeps a copy before a Codex agent's edit;
- a project file shows which Codex agent changed it last (#5812, through filewriters.noteWrite).

## How
1. `engine/codexhooks.js` (new): `install(home, bridge, version)` writes, into the agent's PRIVATE runtime home
   (codex-homes/<key>, Kosmos-owned since #4592):
   - `hooks.json`: one PreToolUse group, matcher `apply_patch`, command = the quoted bridge path;
   - the hook's trust record in `config.toml`: `[hooks.state."<canonical home>/hooks.json:pre_tool_use:0:0"] trusted_hash =
     "sha256:..."`. Hooks are ON by default in 0.149.1, and in the TUI (how Kosmos runs Codex) an untrusted or changed
     hook STOPS the agent on "Hooks need review" (review 1; measured both arms in the TUI). The hash is Codex's
     version_for_toml of the normalized identity (equal to the record Codex's own trust wrote for this exact hook).
   - ONLY for HASH_VERIFIED_FOR, the one Codex version the hash was verified for (a test holds it equal to runners.js's
     pin, so a bump fails until it is moved); the key on the home's canonical path (Codex resolves it); the record is
     written BEFORE hooks.json; and on every refusal our hooks.json is removed, so there is never an untrusted hook for
     the TUI to stop on.
   - Under the same file lock create.js's trustCodexFolder takes. Present and equal: no write. Absent: appended, really (open 'a',
     flushed; codex writes this file too; an append cannot lose its edit). Present with a different hash in our exact one-line form:
     that line replaced (a second table with the same key would be a TOML duplicate and codex would not load the config).
     Present in any other form (a person set enabled = false, say): left alone, and said.
2. `bin/codex-report-bridge.js`: a second mode. Notify passes its event as argv (unchanged); a hook passes JSON on stdin
   with no argv. For PreToolUse + apply_patch it parses the patch's `*** Add File: `, `*** Update File: `, `*** Delete
   File: ` and `*** Move to: ` lines as Codex's patch engine does (measured in reviews 3 to 5: the path is everything
   after ": " with only its end trimmed; an indented heading counts, except inside an Update hunk, where an indented line
   is context), resolves each against the payload's cwd, and posts one keep per path (at most 20, in
   parallel, each bounded at 3 s). Prints nothing; always exit 0 (a hook that fails must never stop the edit).
3. `bin/agent-supervisor.sh`, the codex launch: read `codex --version` and run the install against the runtime home. A
   failed install launches the agent as today, with no hooks.json, and says so. No features flag: hooks are on by default.

## Residual, stated
- A first `codex --version` slower than 5 s (macOS checking a freshly updated binary) launches that agent without the
  hook, said in its log only.
- Who wrote a file: the board names a Codex agent by its folder (undo.ownerOf matches session ids only for Claude), so
  a Codex agent's edit is attributed only when its working folder is its own agent folder, as Kosmos launches it; any
  other folder gets no undo copy and no writer, never a wrong one.
- PreToolUse runs before Codex applies the patch, so a patch Codex then rejects (context that does not match, a
  misplaced Move to) still sends its keeps and records this agent as the writer, as Claude Code's Edit hook does; the
  board's write window bounds it.
- The hook goes only into a separate private home: a launch whose private home resolved to the account home (warned
  since #4592) gets no hook.
- Rolling Kosmos back to a build before this one leaves the hook and its record in each Codex home. Harmless with the
  same Codex: 0.149.1 has been the only Codex pin since the runner manifest began (cae0a88124, 08-26), so the record
  still matches. It would show the review screen only for an older Kosmos launching a DIFFERENT, self-installed Codex
  that hashes differently.

## Not in this change
- Windows (win32keyed's codex launch): a separate slice, as #6033 was for Claude.
- Writes through `exec_command` (a shell redirect, sed -i): no path to read reliably; never guessed.
- Grok and Antigravity (#5812 items 3 and 4).

## Weakest premise
The trust hash is Codex's internal format, and a wrong one stops the agent at launch (the TUI review screen), not
silently. Bounded by: install only for the pinned version; the pin in the test is the hash Codex itself wrote; the
real-Codex test (when the pinned Codex is installed) asserts the hook runs and a broken record does not. Residual: a
Codex bump in runners.js without re-measuring would turn the hook off for everyone (version mismatch), never on the
review screen; the real-Codex test then fails where that Codex is installed.
