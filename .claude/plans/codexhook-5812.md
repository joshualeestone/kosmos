# codexhook-5812: a Codex agent's file edits record their writer and keep an undo copy (#5812 item 2)

## What
A Codex agent edits files through `apply_patch`. Codex 0.149.1 (the pinned build) runs a PreToolUse hook before it, with
`tool_input.command` = the whole patch text (measured 10-16 against the real CLI and a local fake Responses server; card
comment 6219788459). This change wires that hook to the same board call the Claude and Gemini hooks make
(`POST /api/undo/keep {path, cwd, session}`), once per file the patch names, so:
- the undo switch (#5153) keeps a copy before a Codex agent's edit;
- a project file shows which Codex agent changed it last (#5812, through filewriters.noteWrite).

## How
1. `engine/codexhooks.js` (new): `install(home, bridge)` writes, into the agent's PRIVATE runtime home
   (codex-homes/<key>, Kosmos-owned since #4592):
   - `hooks.json`: one PreToolUse group, matcher `apply_patch`, command = the quoted bridge path;
   - the hook's trust record in `config.toml`: `[hooks.state."<home>/hooks.json:pre_tool_use:0:0"] trusted_hash =
     "sha256:..."`. Codex skips an untrusted hook SILENTLY; its TUI review is the only other way to trust, and an
     unattended agent never sees it. The hash is Codex's version_for_toml of the normalized identity (reproduced against
     two TUI-written records; a one-digit change makes the hook not run).
   - Under the same file lock create.js's trustCodexFolder takes. Present and equal: no write. Absent: appended (codex
     writes this file too; an append cannot lose its edit). Present with a different hash in our exact one-line form:
     that line replaced (a second table with the same key would be a TOML duplicate and codex would not load the config).
     Present in any other form (a person set enabled = false, say): left alone, and said.
2. `bin/codex-report-bridge.js`: a second mode. Notify passes its event as argv (unchanged); a hook passes JSON on stdin
   with no argv. For PreToolUse + apply_patch it parses the patch's `*** Add File:`, `*** Update File:`, `*** Delete
   File:` and `*** Move to:` lines, resolves each against the payload's cwd, and posts one keep per path (at most 20, in
   parallel, each bounded at 3 s). Prints nothing; always exit 0 (a hook that fails must never stop the edit).
3. `bin/agent-supervisor.sh`, the codex launch: run the install against the runtime home, and add `-c features.hooks=true`
   only when it succeeded. A failed install launches the agent as today, without the hook, and says so.

## Not in this change
- Windows (win32keyed's codex launch): a separate slice, as #6033 was for Claude.
- Writes through `exec_command` (a shell redirect, sed -i): no path to read reliably; never guessed.
- Grok and Antigravity (#5812 items 3 and 4).

## Weakest premise
The trust hash is Codex's internal format. A Codex bump that changes it makes the hook stop running with no error.
Guard: a test that runs the REAL installed Codex (when it is the pinned version) against a fake server and asserts the
hook fired; skipped, and saying so, when that Codex is not present.
