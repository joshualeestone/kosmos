# win32 report hook: exec form so it fires without a shell (#570)

## Problem

The native-win32 self-report hook (engine/reporthook.js `entryFor`) was wired as a
SHELL-FORM command: `"<node>" "<script>"`. That was measured working on the Windows box
(tmnt-windows, 2026-09-07) because that box has Git Bash, and Claude Code runs a Windows
hook through the bash it locates.

But the Claude Code hooks docs state the hook shell "defaults to bash, or to powershell on
Windows when Git Bash isn't installed." On a stock Windows box with no Git for Windows the
fallback is PowerShell, and PowerShell parses a statement that begins with a double-quoted
token in expression mode: it echoes the quoted path rather than executing it (running a
quoted-path executable in PowerShell needs the `&` call operator). So on such a box the hook
PROCESS fires but the command is a no-op that delivers no report. That is the exact
"the board says could not check forever" failure the whole #570 lane exists to prevent: an
agent that runs but cannot report its state.

## Decision (mine, per Josh 2026-08-31 "make a recommendation, implement that, continue")

Switch `entryFor`'s win32 branch to EXEC form: `{ command: <node>, args: [<script>] }`.

Per the docs, when `args` is present Claude Code spawns `command` as an executable directly,
with NO shell involved, each arg passed verbatim, and the `shell` field is IGNORED. So exec
form fires identically whether Git Bash is present or PowerShell is the fallback: it removes
the shell from the path entirely. That is the shell-independent shape a state source that
must never silently go dark needs, and it is correct regardless of whether the PowerShell
no-op hypothesis is exactly right, because "no shell involved" sidesteps the question.

## What I rejected

- **Keep shell form and make one string work in both bash and PowerShell.** Impossible: a
  single command string cannot satisfy both shells' quoting/execution rules (a `&`-prefixed
  PowerShell form breaks bash). Only removing the shell (exec form) is shell-independent.
- **Refuse `/clear`-style workarounds or a launcher-side reporter.** Out of scope; exec form
  is the minimal, in-place fix to the existing mechanism.
- **Loosen the unsafeForCommand guard for win32.** Not needed and not done. In exec form the
  paths pass verbatim (no shell to inject into), so the guard is now defensive/over-refusal;
  I kept it unchanged in the codebase's stated "over-refuse, never under-refuse" posture
  rather than widen the blast radius of this change.

## Coupled changes the shape move requires

- `entryIsOurs` now also checks `args` for the marker (it moved from the command string into
  args[0]). Backward-compatible: an OLD win32 shell-form entry still carries the marker in
  its command, so it stays recognized as ours and gets REPOINTED to exec form rather than
  doubled.
- `ensureWired`'s "already correct" check compares the full shape (command AND args), so an
  old shell-form entry reads as ours-but-stale and is repointed, while a correct exec-form
  entry is a no-op on re-run.
- Comments across the module updated to describe exec form and to mark the previously-open
  no-Git-Bash question resolved by it.

## Tests

Exec-form shape (command is bare node, args is [script], no embedded script); seven-event
wiring plus idempotency; and the OLD-shell-form to exec-form MIGRATION (the non-vacuity proof
for the entryIsOurs/sameHook changes: an existing shell-form entry must be replaced, not
doubled).

## Weakest premise

The PowerShell "echoes rather than executes" reasoning is from the docs plus PowerShell's
documented expression-mode parsing, NOT run on a box. If Claude Code wraps the shell-form
command (via `&` or Invoke-Expression) before handing it to PowerShell, the old shape already
worked and exec form is a robustness improvement rather than a bug fix. Either way exec form
is the correct shell-independent shape.

## Box-verify hold (do NOT self-merge on green)

This swaps a box-VERIFIED bash shape for an UNVERIFIED exec-form shape. The one-run box check
is: on kosmos-windows-test, wire the exec-form hook (and, as a contrast, the old shell form
with `shell: powershell`) in an isolated CLAUDE_CONFIG_DIR and confirm exec form DELIVERS a
report on all seven events. Until that passes, hold the merge. Routed to the box lane
(tmnt-windows / Baron) via #570 and Splinter, who is tracking the box-verify queue.
