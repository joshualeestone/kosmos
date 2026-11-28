# receiptwin-9263: a Codex patch path keeps its escaped backslashes (kosmos#9263)

## Problem
engine/receipt.js reads the files a Codex agent edited from the `*** Add|Update|Delete File: <path>` lines of a
`tools.apply_patch(` call inside its exec script. The match `([^\n\\"]+)` stopped at the first backslash, because the
patch is a JavaScript string where a newline is written `\n`. A Windows absolute path (`C:\\Users\\...` in the string)
was cut to `C:`, and `path.resolve(folder, 'C:')` gave back the agent's own folder.

## Change
- Match `((?:\\\\|[^\n\\"])+)`: an escaped backslash (two characters) is part of the path; any other backslash
  escape or a quote ends it. Unescape `\\` to `\` before resolving.
- Test fixture (`engine/receipt-5153.test.js`) writes paths escaped, as the JavaScript string carries them, and adds
  a relative path with a backslash (`lib\deep.js`), which reads `lib` without the fix on ANY host, so the defect is
  guarded on the Mac as well as on Windows. The expectation for the absolute path uses `path.join('src','new.js')`,
  since a receipt shows the host's own separator (shownPath is path.relative).

## Rejected
- Exporting a pure `codexPatchPaths()` for a unit test: a new engine export trips engine.reachable unless excused,
  and the existing end-to-end test can carry a host-independent red arm.
- Normalising shown paths to `/`: changes what every receipt shows on Windows, beyond this card.

## How a path is read
The path is a JavaScript string's text, so it is decoded as one: it ends at an escaped newline (`\n`, `\r`), a real
newline, or a bare quote, and its escapes are decoded (`\\`, `\'`, `\"`, `\t`, `\uXXXX`...). An escape a string
cannot hold (`\U`) is what a single-backslash path (String.raw) looks like; such a path cannot be read whole and is left
out. A path that resolves to the agent's own folder is never listed: that is the card's symptom, and no patch line
names the folder itself.

Not covered: a single-backslash path whose next character happens to make a real escape (`C:\new.js` in String.raw
reads as `C:` then a newline). The folder filter still keeps it from showing as the folder on Windows; on macOS and
Linux it would show as a file named `C:`. A real Codex script was not measured writing String.raw.

Design note: review rounds 2, 3 and 4 each reworked the same rule (what ends or cuts a path). Decoding the text as the
string it is replaced the stop-rule patches.

## Weakest premise
How a real Windows Codex writes an absolute path in its exec script (escaped `\\`) is reasoned from the script
being a JavaScript string, not measured on a Windows Codex session. A path written with forward slashes already read fine.

## Validation
Measured (round 0): `node --test engine/receipt*.test.js` 43/43 with the fix; without the fix the new arm reads `['src/new.js','notes.md','lib']`.
