# #8770: `kosmos` runs from cmd, scheduled tasks and node spawn on Windows

**Posture:** production

## Done when
1. `kosmos agent list` run from `cmd.exe`, from node `spawn('kosmos', args)` without a shell, and from a scheduled task returns the board's real agent list on Windows (measured on the box against the installed CLI).
2. Agents are unaffected: with all three files in one folder, Windows PowerShell 5.1 and pwsh 7 still resolve a bare `kosmos` to `kosmos.ps1`, and Git Bash to the extensionless shim (measured).
3. No new command-injection path: a correctly caret-escaped `&` from cmd stays text (the same line through a `.cmd` wrapper runs the injected command, as a control).
4. The exe is committed signed, reproduces from its source (`verify-launcher.ps1 -Cli`), and the build refuses it unsigned, older than its source, or missing from the zip.

## Decided
- **A signed `bin\kosmos.exe`, not a `.cmd`.** The card proposed a `.cmd`. Rejected because cmd re-parses `%*` inside a batch file, so `kosmos msg x a^&calc` runs `calc` (BatBadBut; measured on the box with a one-line `.cmd`). A `.cmd` also cannot be spawned by node without a shell, and one was shipped and removed for this reason before.
- The exe (`tools/windows/cli/KosmosCli.cs`) writes its argv as the JSON `--kosmos-argv-file` that `kosmos.ps1` already uses, so no second command line carries the words. It starts node with `CreateProcess` and exactly its own stdin, stdout and stderr (a missing stream becomes NUL), inside a kill-on-close job, and returns node's exit code.
- It lives in `tools/windows/cli/` because `kosmos.exe` and `Kosmos.exe` collide on a case-insensitive file system. The output name is compiled in, so it stays `kosmos.exe`.
- It is not in win32update's `REQUIRED_ENTRIES`: a zip from before #8770 is still a whole build, and an update or rollback replaces `bin` whole.
- Rejected: documenting only the `node.exe kosmos-cli.js` form. It leaves the card's "not recognized" for every cmd and spawn caller. It stays the fallback if Baron prefers not to carry a second committed binary.
- Weakest part: a second committed signed binary that only this box can rebuild and sign; every change to `KosmosCli.cs` means rebuild, re-sign and commit together (the build's order check enforces it). Also, anything node starts ends with the command, because of the job. No verb starts a long-lived child today; a future one must break away. Would change my mind: Baron preferring not to carry the binary, or a verb that needs to start something that outlives the CLI.

## Review rounds (blind)
- Round 1: 0 BLOCKER, 2 WARNING (Ctrl+C returned before node; a killed exe orphaned node holding the caller's pipes), NITs. All fixed: kill-on-close job, Ctrl+C left to node, lone surrogate refused, launcher-neutral error wording.
- Round 2: 0 BLOCKER, 2 WARNING (a gap before node joined the job; Ctrl+Break also cancelled). Fixed: the exe joins the job before node starts; only Ctrl+C is cancelled.
- Round 3: 0 BLOCKER, 1 WARNING (started with no console, node's output was lost). Fixed: CreateProcess with STARTF_USESTDHANDLES; a detached-spawn test added (failed before, passes now).
- Round 4: 0 BLOCKER, 0 WARNING; converged. Its 3 NITs were fixed (missing stream becomes NUL, real no-console test, wait result checked).
- Left as accepted: an argv file can stay in TEMP if the exe is killed before node reads it (same as `kosmos.ps1`).
