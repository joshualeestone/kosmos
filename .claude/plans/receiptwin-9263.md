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
newline, or a bare quote, and its escapes are decoded (`\\`, `\'`, `\"`, `\t`, `\uXXXX`, `\u{...}`, `\xHH`...).
Left out of the receipt, as paths that cannot be trusted whole:
- an escape with no special meaning (`\U`). It is LEGAL JavaScript (an identity escape: `"C:\Users"` is `C:Users`), but
  in a path it is far likelier a single backslash written raw (String.raw), so it is treated as one. A judgement about how
  Codex writes paths, not a language rule (review round 5 corrected my comment, which said a string cannot hold it).
- a decoded control character (`C:\tools.js` written raw decodes a tab), never part of a real file name.
A path that resolves to the agent's own folder is never listed: that is the card's symptom, and no patch line names the
folder itself.

Not covered: a single-backslash raw path whose escape decodes to a printable character (`C:\x41.js` raw reads
`C:A.js`), and one cut by `\n`/`\r` (`C:\new.js` raw reads `C:`: the folder filter catches it on Windows, macOS and
Linux would show a file named `C:`). A real Codex script was not measured writing String.raw.

Design note: review rounds 2, 3 and 4 each reworked the same rule (what ends or cuts a path). Decoding the text as the
string it is replaced the stop-rule patches; round 5 tightened what the decoder trusts.

## Weakest premise
How a real Windows Codex writes an absolute path in its exec script (escaped `\\`) is reasoned from the script
being a JavaScript string, not measured on a Windows Codex session. A path written with forward slashes already read fine.

## Validation
Measured (round 0): `node --test engine/receipt*.test.js` 43/43 with the fix; without the fix the new arm reads `['src/new.js','notes.md','lib']`.
