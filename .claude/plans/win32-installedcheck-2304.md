# Plan: installedCheck requires the runner on win32, not tmux (kosmos#2304)

## Problem

On Windows, `machine.installedCheck()` permanently reports `attention`, tells the
user their computer cannot run agents, requires tmux, and points them at the macOS
download + a Homebrew tmux path (`/opt/homebrew/bin/tmux`) - because it requires
tmux on EVERY platform (`parts = [['tmux', ..., true]]`). Windows has no tmux and
needs none: the #570 port runs agents through the Claude CLI (`claude agents
--json` for the roster/capture, `claude --session-id` for create). So the health
check fails on exactly the arrangement the port was built to make work. This is
the sibling arm of the same #570 defect `create.unusablePath` already narrowed
(create.js docblock names installedCheck explicitly).

## The call

Platform-inject `installedCheck` via `opts.platform` (default `process.platform`) -
the same pattern `create.unusablePath(bin, platform)` and `ownerOnlyModeIsEnforced`
use so both branches are assertable from a Mac:
- **win32**: the required "part that runs agents" is the RUNNER (claude); tmux is
  not probed at all (there is none, and its default is a macOS Homebrew path);
  codex stays informational.
- **darwin**: unchanged - tmux required, runners informational (#979: don't
  require Claude for an OpenAI user).

Result: a Windows box with the runner present returns `ok` ("Everything it needs
is on this computer") instead of the tmux/macOS attention message.

## What I rejected

- **Building an "at least one runner" required-set now.** Simpler and grounded to
  require claude, because codex-on-win32 is not wired yet (win32roster/capture/
  create are all Claude-CLI based). When a codex path lands on Windows, the
  required set becomes "at least one runner". Documented as the weakest premise.
- **Inventing a Windows remedy copy (defect 2).** The "Download for macOS" remedy
  still fires on the narrower win32-runner-MISSING case. Fixing it needs the
  Windows download target (a #570 / product decision, possibly not published), and
  Josh owns the final phrasing of this screen. Flagged as a follow-up rather than
  invented. The REPORTED bug (runner present -> ok) is fixed without touching it.
- **Changing the darwin copy** to be platform-neutral: that is a product-copy
  change to the Mac path, which Josh sets live.

## Weakest premise

win32 requires claude SPECIFICALLY (not "at least one runner") because the current
win32 substrate is the Claude CLI. If the #570 lane intends codex-on-win32, the
required set must widen to "at least one runner" so an OpenAI-only Windows user is
not wrongly blocked (the #979 lesson, applied to win32).

## Verification

- Unit tests assert BOTH branches from this Mac via the `platform` opt (the #570
  pattern): the reported bug (win32 + runner present -> ok, no tmux/macOS copy); a
  win32-SCOPED control (identical input is still `attention` on darwin - proves the
  branch did not leak); the #979 GPT-only case unchanged on darwin; and a win32
  missing-runner naming "the part that runs agents" at the runner path, never tmux
  or a Homebrew path. machine.test.js: 41/41.
- End-to-end verification on a real Windows box is for the #570 lane (I have no
  Windows); the LOGIC is fully unit-tested per-platform, which is how this
  codebase asserts win32 branches (create.unusablePath, ownerOnlyModeIsEnforced).

## Refinement (challenge-loop iteration 1)

The platform injection is split across three platform-dependent reads, and only
two can be injected:
- **Injected**: the required-part list (tmux vs runner) AND the unusable-path
  CHARACTER check `create.unusablePath(bin, platform)` -- so a normal win32
  backslash path is not misread as unusable, and the win32 arm is assertable from
  a Mac.
- **Host-platform by contract**: `runners.isRunnable` is used as an Array callback
  `(el, i, arr)` and must stay single-argument (`runners.runnableExactly`'s comment
  + `engine.runnable-not-directory.test.js`), so it reads `process.platform`,
  correct on the machine it runs on. Threading a param into it breaks the callback
  contract (a first pass did, and judged a POSIX test bin unrunnable under the
  win32 extension check). It is deliberately left host-platform; the comment warns
  against re-adding the param.

Defect 2 is on BOTH failure arms (the missing-runner "Download for macOS" remedy
AND the unusable-path "parts of macOS" / "a backslash" detail), each needing a
platform copy branch + the Windows download target.

## Out of scope / follow-ups

- Defect 2: the win32 remedy copy (a Windows download, not macOS) - needs the
  Windows download target + Josh's phrasing.
- "At least one runner" once codex-on-win32 is wired.
