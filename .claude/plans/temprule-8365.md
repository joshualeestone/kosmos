# temprule-8365: one temp-path rule (item 1 of #8365)

#8348 moved the #1582 "temp path into a durable file" rule into engine/hookpaths.js (ephemeralIntoDurable) for Gemini
and Codex, and on win32 it now matches a case-changed, 8.3 short or other-slash spelling of the temp folder. Two
copies kept the old rule and its gap: reporthook.ephemeralMismatch (Claude's report hook, and allowance.js's statusline
through it) and an inline block in groksettings.js (Grok).

## Change
- reporthook.ephemeralMismatch keeps its name, callers and history comment, takes an optional { platform }, and
  returns hookpaths.ephemeralIntoDurable. ensureWired passes its platform.
- groksettings.ensurePrepared calls hookpaths.ephemeralIntoDurable with its platform; the refusal sentence is unchanged.
- The now-unused `os` requires go from both files.
- Posix behaviour is the same rule line for line (raw and resolved temp root, non-string neither durable nor ephemeral,
  null paths skipped).

## Not in this slice
Item 2 (a test seam through win32codexsup.js's default installCodexHook closure) is Windows-lane code: left on #8365.

## Tests
reporthook.test.js and groksettings.test.js each get a host-independent win32 case (a backslash spelling of the temp
folder is refused), run in a fresh cwd box because on a Mac a backslash path is relative. 48 related files green.
4 mutation arms red (posix rule at each call site; rule removed), run with a fresh HOME per run.
