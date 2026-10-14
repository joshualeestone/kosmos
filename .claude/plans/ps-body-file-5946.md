# #5946: a body path that works in every shell, and a PowerShell pipe that names it

**Branch:** `ps-body-file-5946` · **Issue:** kosmos#5946 (Addresses, not closes)
**Posture:** production

## What finished looks like

A Windows agent posts a multi-line community post, a comment and a feedback report from PowerShell on
the first try, and when it pipes text in (the habit every Mac agent and every heredoc example teaches),
the refusal says at once exactly what to type instead. Observed on a real Windows 11 box against a stub
board, never the real board.

## Measured before the change (Windows 11, PowerShell 5.1, the shipped kosmos.ps1 + kosmos-cli.js)

How: a staged copy of the zip layout (bin\kosmos.ps1, bin\kosmos-cli.js, runtime\node.exe, app\engine as a
junction to this checkout), a recording stub board on 127.0.0.1:16999 (`KOSMOS_PORT`), a throwaway data root
(`AGENT_WORKFORCE_DATA`, so no real board token was read), and `AGENT_WORKFORCE_FEEDBACK_URL` pointed at the
stub so `feedback write` never reached the Kosmos team. Each case ran as `powershell -NoProfile -Command`
with stdin closed (null), an empty closed pipe, and a pipe held open (what a tool runner does). Body: two
lines, "café" and a rocket emoji. KSECS is the time PowerShell measured around the kosmos call itself.

| Verb | How the text was given | stdin null / empty pipe | stdin held open | Sent? |
|---|---|---|---|---|
| post, comment, feedback | `"a`nb" \| kosmos ...` | exit 2 at once, "Nothing to post/send/write ... (pass it as an argument, or pipe it in on stdin)" + the old PS note | exit 2 after **3.1 s** (the quiet limit), same words | no |
| same | `@'...'@ \| kosmos ...` | same as above | same, 3.1 s | no |
| same | `Get-Content f \| kosmos ...` | same | same, 3.1 s | no |
| same | `kosmos ... @'` (here-string ARGUMENT) | exit 0, body arrives byte-exact (newline, é, emoji) | exit 0 | yes, intact |
| same | `kosmos ...` then `@'` on the NEXT line (the old note's literal "@' on its own line") | exit 2, kosmos got no text (the here-string is then just printed) | exit 2 after 3.2 s | no |
| post, comment, feedback | `--body-file f` | exit 2, "--body-file is not an option" | same | no |
| reply --stdin | `"a`nb" \| kosmos reply --stdin` | exit 2, nothing piped | waits as long as the pipe stays open, up to **120 s** | no |

No encoding damage and no wrong send in any case: the failure is always "your text did not arrive", and the
only working PowerShell form was the here-string argument. The old note told agents to put `@'` "on its own
line", which read literally leaves kosmos with no text.

## Measured after the change (same harness, the branch's shim and CLI)

| How the text was given (post, comment, feedback) | Result, all three stdin modes |
|---|---|
| `"a`nb" \| kosmos ...`, `@'...'@ \| kosmos ...`, `Get-Content f \| kosmos ...` | exit 2 in 0.1-0.2 s (also with stdin held open), "Nothing was posted/sent/saved: text piped into kosmos in PowerShell does not reach it. Save the text in a file and give its path: kosmos community post --body-file <file>" + the here-string alternative; nothing sent |
| `... \| Out-File f` then `--body-file f` (UTF-16LE) | exit 0, body byte-exact (two lines, é, emoji) |
| `... > f` then `--body-file f` (UTF-16LE) | exit 0, byte-exact |
| `... \| Set-Content -Encoding UTF8 f` then `--body-file f` | exit 0, byte-exact |
| `... \| Set-Content f` (no -Encoding: ANSI) then `--body-file f` | exit 2, "f is not UTF-8 text ... Write it with Set-Content -Encoding UTF8 <file> or Out-File <file>"; nothing sent |
| `kosmos ... @'` (here-string argument) | exit 0, byte-exact (unchanged) |
| `kosmos ...` then `@'` on the next line | exit 2, the empty-body message now names --body-file (3.2 s with stdin held open, as before: nothing was piped, so stdin is still read) |
| `"a`nb" \| kosmos reply --stdin` | exit 2 in 0.1 s (was: as long as the pipe stayed open, up to 120 s) |

Separately measured: `printf report | powershell -File kosmos.ps1 feedback write` DOES deliver the report
(node inherits the host's stdin there), and `$MyInvocation.ExpectingInput` reads true in that mode as well as
for an in-session pipe.

## The change

1. **`--body-file <path>`** (also `--body-file=<path>`) on `feedback write`, `community post`, `comment`,
   `edit` and `endorse` in `tools/windows/kosmos-cli.js`. Taken out of the words anywhere before a bare `--`.
   Decoded by its byte order mark (`textFileDecoded`): PowerShell 5.1's `Out-File` and `>` write UTF-16LE with
   a BOM, `Set-Content -Encoding UTF8` writes UTF-8 with a BOM. A file that is not valid UTF-8 (plain
   `Set-Content` writes the ANSI code page) is refused with the command that writes it right; a NUL means a
   markless UTF-16 file and is refused the same way. CRLF arrives as LF, trailing line breaks go (as for piped
   text). Capped at the board's 6 MB (stat before read). Words plus --body-file, a second --body-file, or no
   path are refused. The file is never deleted.
2. **kosmos.ps1 tells the CLI when PowerShell piped something in**: it reads `$MyInvocation.ExpectingInput`
   (never `$input`, the hang the file's NEVER READ note is about) and passes `--kosmos-ps-pipeline` after the
   argument file. Exception: when the powershell process was started to run this very file (`-File`), the flag
   is not sent, because there node does get the stdin.
3. **With that flag the stdin readers refuse at once**, naming `--body-file` with the exact command and the
   here-string alternative; nothing is read from stdin (it is not the agent's text). This covers the five body
   verbs, the `--stdin` readers (reply, msg, post) whose read waits up to 120 s, and `connect`.
4. **Words**: usage lines name `--body-file`; the empty-body notes name it first; the not-ended messages say
   "save it in a file instead"; the PS note now says `@'` goes at the END of the command's line. Agent
   instruction text: the community block's QUOTING_RULE (`engine/communityblock.js`) and the daily feedback
   line (`engine/roles.js`) name `--body-file` for PowerShell.

5. **Apostrophes (added mid-review from evidence on Josh's Windows box):** in PowerShell an apostrophe inside a
   plain single-quoted argument ('Can't') ends the string, so the command fails with a parser error before kosmos
   runs and a reply never sends. Every message command is covered with the form that survives it, and one plain
   line says why: the working-rules block (`engine/defaults.js`, `### Formatted messages need line breaks`) now says
   to pass EVERY message in PowerShell, even one line, as a single-quoted here-string, names reply, msg and post,
   and names --body-file for community post, comment and feedback write; the community block and the feedback
   line give the same reason. DOCTRINE_VERSION 30 -> 31 (same heading, so existing agents with an unedited copy
   are offered it through doctrine-past). The generator (`tools/doctrine-past.js`) run on this box DROPPED two
   old v21 rows and one section hash that this clone's history does not reach (no prefix warning: the commits are
   simply not here), which would stop an agent holding such a copy from being recognised. So the generator now
   (a) reads history from the default branch (origin/main, else main, else HEAD) plus the working copy, never a
   feature branch's own intermediate commits (drafts no agent received), and (b) keeps every row and section in
   the table COMMITTED on that branch unless the run left the block out on purpose (the prefix rule). Rejected:
   keeping rows from the working file (a draft row, once written, would then outlive a squash merge and need a
   manual removal step). `engine/doctrine-past.js` is its exact output (it logs "kept 2 row(s)"), and a rerun
   gives the same file. The generator is now a function (`generateDoctrinePast(root, log)`) tested in
   `tools.doctrine-past-5946.test.js` against a throwaway git repository: a foreign row survives, a branch
   draft is not written, a rerun is identical, a left-out prefix block does not come back, no committed table
   is fine. Each fails with its guard removed (measured). The ref is never fetched: when HEAD has defaults.js commits
   the ref lacks, the run warns that they get no row and to fetch and rerun if the ref may be behind.
   The feedback line in `engine/roles.js` reaches only agents made after this (role text has no offer path);
   existing agents learn the PowerShell form through doctrine v31 (numbered 29 before the rebase onto main, which had taken 29 and 30).
6. **`feedback triage --cards -`** refuses a PowerShell pipe at once too (its read also waits up to 120 s).
7. **Git Bash paths:** `tools/windows/kosmos.sh` turns MSYS path conversion off for every argument (so a message
   mentioning /c/x is not rewritten), which left `--body-file /tmp/x.txt` (mktemp's) reaching Windows node as
   the drive-root path, refused as missing. The shim now runs --body-file's value (both forms) through
   `cygpath -w` when it starts with `/`, and nothing after a bare `--`. A Windows+Git Bash test pins it.

## Decisions (and what would change them)

- **Refuse a non-UTF-8 file rather than guess cp1252.** Rejected decoding as Windows-1252: right on this box,
  wrong on any other code page, and the result is published. Weakest part: an agent whose first try is plain
  `Set-Content` with an accented letter is refused once (the message names the fix); with only ASCII it works.
  An emoji written by plain Set-Content is already `?` on disk and cannot be detected. Would change if Kosmos
  could read the system ANSI code page cheaply.
- **The Mac CLI (install/kosmos) does not get --body-file here.** The instruction text that names it is
  scoped to PowerShell. Would change if Mac agents start being taught it. Follow-up filed as kosmos#5970
  (Mac parity for --body-file), so a Mac agent that generalises the PowerShell hint is not refused.
- **The 6 MB cap is on the file's bytes.** A UTF-16 file (Out-File, `>`) uses two bytes a character, so one of
  3-6 MB of text is refused though its UTF-8 would fit. Kept simple: no community post or report is that long.
- **-File detection: any host argument naming this script**, resolved both against the process folder and
  against PowerShell's own location (pwsh's -WorkingDirectory), compared to $PSCommandPath. Any argument BEFORE the script's own path (the agent's words after it are never read, so a topic of /c or -e cannot pass for -Command, and no word is resolved as a path), not
  only the value after -File, so pwsh 7's positional form (`pwsh kosmos.ps1 ...`) and -File abbreviations are
  covered. A host started with -Command, -EncodedCommand or -CommandWithArgs (or an abbreviation) is never the -File case, so the
  scan is skipped there: a pipe inside the command text stays flagged even when the script's path is one of the
  host's arguments (tested). Rejected: matching only the value after -File (misses the positional form). An 8.3 short path
  would not match, and the flag would be sent: the result is a clear refusal, not a silent loss. Measured on
  Windows PowerShell 5.1 only (absolute, relative and forward-slash -File forms are tested); pwsh 7 is not
  installed on this box, so its behaviour is unmeasured.
- **--body-file folds CRLF to LF everywhere in the text; piped stdin keeps inner CRLF (as before).** Every
  Windows file writer uses CRLF, which the agent never typed; piped text is kept exactly as the Mac keeps it.

## Tests

`tools.windows-kosmos-cli-body-file-5946.test.js` (picked up by tools/windows-tests.js through its
`tools.windows-*` rule): 15 tests. Seams for every verb, every refusal and the not-ended messages; the default
file reader on a real file; and four Windows-only runs of the shipped shims (Claude Code's PowerShell tool form
with an open stdin and each call timed; Out-File, Set-Content -Encoding UTF8 and `>` files to a stub board; the
-File exception in three path forms; Git Bash with a /tmp path). With the shim and CLI reverted the first 13
written all failed; the piped test, the -File test and the Git Bash test each fail with only their shim's half
reverted. `tools.doctrine-past-5946.test.js`: 3 tests on the generator (see item 5).
Updated pins: communityblock.test.js, defaults.test.js, tools.windows-kosmos-cli-570, -community-4330,
-endorse-4913, -shims-570.
