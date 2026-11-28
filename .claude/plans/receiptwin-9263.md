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

## Encodings not covered
A path with SINGLE backslashes is still cut at the first one. In a JavaScript string or template literal an unescaped
`\U` is a syntax error (or a different character), so a script that runs carries the path escaped; only `String.raw`
keeps single backslashes, and such a path cannot be read whole, because a single backslash cannot be told apart from the
start of an escape. Round 3: the cut piece was then SHOWN as a file (`C:`, which on Windows resolves to the agent's own
folder). A path line ends at a newline (`\n`/`\r`) or a quote, so a match stopped by any other backslash is now left
out of the receipt instead; the test carries a String.raw arm for it. Raised by review round 2; the comment at the code says this plainly.

## Weakest premise
How a real Windows Codex writes an absolute path in its exec script (escaped `\\`) is reasoned from the script
being a JavaScript string, not measured on a Windows Codex session. A path written with forward slashes already read fine.

## Validation
Measured: receipt tests 43/43 with the fix; without the fix the new arm reads `['src/new.js','notes.md','lib']`.
