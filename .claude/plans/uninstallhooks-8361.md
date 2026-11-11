# uninstallhooks-8361: removing Kosmos on Windows takes its Gemini and Codex hooks out too (kosmos#8361)

## Problem
The Windows uninstall took Kosmos's report hooks out of Claude Code's settings only (#5999). The Gemini hooks it writes into each Gemini home stayed, naming this install's node.exe, which the person deletes next; so would the Codex hook (#8348) in each ~/.codex-<label>.

## Change
`unwireHooks` in engine/win32uninstall.js also goes through every Gemini settings file Kosmos writes: the default agent home's (`~/.gemini/settings.json`, or AGENT_WORKFORCE_GEMINI_HOME) each named account's (`~/.gemini-<label>/.gemini/settings.json`), and each key home under the data folder (`gemini-key-home\<label>\.gemini\settings.json`), which stays when the data is kept. Same rules as Claude's, through the same `reporthook.unwireInstall`, now given the marker to look for: only this install's entries, or ones whose script, or for Gemini whose node.exe (the part that breaks, since the bridge lives in the data folder), is provably gone; a person's hook, another install's and anything else stay; under the #3088 lock on the uninstall side (the Gemini writers take no lock; the no-task, no-board gate is what keeps them from running); only once no task or board can wire them back. The sentences name Gemini CLI, and say only that it may show a hook error, since Gemini's leftover has not been measured.

## Codex half (Homer, 11-11, after #8348's Windows Codex hook merged as #8367)
- `codexhooks.unwireInstall(home, roots, { gone, platform })`: takes out OUR hooks.json (isOurs: the exact shape
  install writes) only when its node or its bridge lies in this install's folder (every spelling, case- and
  slash-blind, as reporthook.unwireInstall compares) or one of them is provably gone; another install's live hook
  stays. hooks.json goes first (a lone record is inert), then the trust record, and only when it is exactly the heading for the canonical hooks.json followed by
  the one trusted_hash line with that command's hash; a record anyone changed stays. Both under the config.toml lock
  install takes. The blank lines after the record go with it, never the file's final newline; a record that cannot be rewritten leaves
  the hook taken out all the same.
- `win32uninstall.unwireHooks` runs it on every `~/.codex-<label>` (codexHomes), the only homes the hook is ever written
  into (win32codexsup never gives it to the person's ~/.codex), after the Gemini loop, with done/left sentences.
- Tested in engine/uninstallhooks-codex.win32-8361.test.js (15): this install's hook plus record, the rest of the config
  kept, a mid-file record, a key below the record keeps the record, another spelling of the folder, another install's
  live hook kept, a gone bridge taken, a gone node.exe taken but an unplugged drive kept, a hand-changed record kept, a
  person's own or missing hooks.json untouched, an unreadable hooks.json never claimed as ours, a busy config.toml
  lock leaving both files as they were, a hooks.json swapped between the look and the lock left alone, a lookalike folder or a `..` path not counted as this install, and a CRLF config.toml keeping its record.
- A hooks.json Kosmos cannot read is not called Kosmos's (in a ~/.codex-<label> it can be the person's own): the
  uninstall gives a note saying to delete it only if it names codex-report-bridge.js. The same note covers one that
  turned into a non-file or changed under the lock, and a Codex check that failed outright.
- A config.toml saved with CRLF line endings keeps its trust record (lines are matched on LF only). That is safe, a lone
  record does nothing, and install() writes LF.
- As #5999's unwireOne: a busy config.toml lock is a leftover (close the other program and remove Kosmos again); a
  folder that refuses the lock, or a hooks.json that cannot be deleted, is `stuck` and goes to the notes, so the
  removal can still finish.
- Review: 8 rounds, the fleet cap. Round 8's WARNING (the stuck case above) was fixed after round 8 and not reviewed
  again; the proof says converged: false.

## Decided (at the Gemini half; the Codex point below is superseded by the section above)
- The Codex half is not built here. `codexhooks.removeOurs` exists, but on main the Codex hook is installed only by the Mac supervisor: nothing on Windows writes it, and #8348 (the Windows Codex hook) is an open card with no code. Calling a removal for a Windows file that is never written, with a trust-record shape not yet decided for Windows, would be a guess, so the removal belongs with #8348; noted on both cards.
- The default Gemini home is included as well as the named ones: Kosmos writes the same hooks there and they break the same way.

## Weakest premise (Codex half)
That the hook table holds nothing but our one trusted_hash line, which is all install writes; a table with anything else
is left (the record stays and hooks.json still goes, which is safe: a lone record is inert). Not run on a real Codex
home after a real uninstall; the tests use the real install() on temp homes.

## Weakest premise (Gemini half)
That Gemini's settings file reads as Claude's does (one JSON object, `hooks` by event, `{ hooks: [{ type, command }] }` entries), which is what geminisettings.js writes. Not run on a real Windows machine. A settings file with comments cannot be read by this step, but geminisettings.js cannot parse one either, so it never wrote hooks into one.

## Not done
- The auth and update settings Kosmos pre-seeds in a person's own `~/.gemini` stay after removal: filed as #8362, since they cannot be told apart from the person's own choice.
- The Codex half is built (section above). Still owed on the card: a real Windows run of the Gemini half (nobody has
  run it on a real named Gemini home).
- A forgotten account (renamed to .removed-codex-<name>) is not covered, as for Claude and Gemini.
- Mac and Linux (#5998's install/setup.sh) are not in this card.
- Grok's hook file is not covered.
