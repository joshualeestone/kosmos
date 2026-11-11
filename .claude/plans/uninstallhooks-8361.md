# uninstallhooks-8361: removing Kosmos on Windows takes its Gemini hooks out too (kosmos#8361)

## Problem
The Windows uninstall took Kosmos's report hooks out of Claude Code's settings only (#5999). The Gemini hooks it writes into each Gemini home stayed, naming this install's node.exe, which the person deletes next.

## Change
`unwireHooks` in engine/win32uninstall.js also goes through every Gemini settings file Kosmos writes: the default agent home's (`~/.gemini/settings.json`, or AGENT_WORKFORCE_GEMINI_HOME) each named account's (`~/.gemini-<label>/.gemini/settings.json`), and each key home under the data folder (`gemini-key-home\<label>\.gemini\settings.json`), which stays when the data is kept. Same rules as Claude's, through the same `reporthook.unwireInstall`, now given the marker to look for: only this install's entries, or ones whose script, or for Gemini whose node.exe (the part that breaks, since the bridge lives in the data folder), is provably gone; a person's hook, another install's and anything else stay; under the #3088 lock on the uninstall side (the Gemini writers take no lock; the no-task, no-board gate is what keeps them from running); only once no task or board can wire them back. The sentences name Gemini CLI, and say only that it may show a hook error, since Gemini's leftover has not been measured.

## Decided
- The Codex half is not built here. `codexhooks.removeOurs` exists, but on main the Codex hook is installed only by the Mac supervisor: nothing on Windows writes it, and #8348 (the Windows Codex hook) is an open card with no code. Calling a removal for a Windows file that is never written, with a trust-record shape not yet decided for Windows, would be a guess, so the removal belongs with #8348; noted on both cards.
- The default Gemini home is included as well as the named ones: Kosmos writes the same hooks there and they break the same way.

## Weakest premise
That Gemini's settings file reads as Claude's does (one JSON object, `hooks` by event, `{ hooks: [{ type, command }] }` entries), which is what geminisettings.js writes. Not run on a real Windows machine. A settings file with comments cannot be read by this step, but geminisettings.js cannot parse one either, so it never wrote hooks into one.

## Not done
- The auth and update settings Kosmos pre-seeds in a person's own `~/.gemini` stay after removal: filed as #8362, since they cannot be told apart from the person's own choice.
- The card's Codex half is not met, so the card stays open after this merges, waiting on #8348.
- Mac and Linux (#5998's install/setup.sh) are not in this card.
- Grok's hook file is not covered.
