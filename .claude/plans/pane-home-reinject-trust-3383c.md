# Plan — #3383c: re-inject HOME into the agent pane so a default-account agent reads the trusted config (0.6.88 launch blocker)

## The failure
On a real laptop (Josh's, GUI-launched Kosmos.app), every NEW agent parks on Claude Code's "Is this a
project you created or one you trust?" prompt, and the app's "Trust & Restart" does nothing. Josh:
"worked ~50 builds, then broke." Agents can't be created and talked to = the launch bar fails.

## Root cause (measured with CONTROLS, with CLAUDE_CONFIG_DIR explicitly UNSET = the clean-machine case)
A tmux pane inherits the shared tmux SERVER's environment, not this supervisor's (measured on 3.6a: a
pane made by a client with HOME=B on a server started with HOME=A gets A). The supervisor re-injects
`CLAUDE_CONFIG_DIR` / `CODEX_HOME` into the pane with `-e`, but NOT `HOME`.

When an agent has no `CLAUDE_CONFIG_DIR` (a DEFAULT-account agent -- the plist sets none, and a
GUI-launched app carries none from launchd; ICK measured `launchctl getenv CLAUDE_CONFIG_DIR` empty),
Claude Code v2.1.278 resolves its folder-trust config as `$HOME/.claude.json`. `engine/create.js`
writes that trust to `homeDir()/.claude.json`. So when the pane's `HOME` (the tmux server's) differs
from `homeDir()`, the agent reads a DIFFERENT `.claude.json` than Kosmos wrote -> the prompt, every
newly-created agent.

MEASURED, WITH A CONTROL (CLAUDE_CONFIG_DIR unset throughout):
- Test A: trust in `H/.claude.json`, pane HOME=H -> NO prompt. So a no-CCD agent reads `$HOME/.claude.json`.
- Test C: server HOME wrong (no trust) + pane HOME re-injected to H (has the trust) -> NO prompt.
- Test D (control): same as C but NO HOME re-injection (pane inherits the server's wrong HOME) -> PROMPTS.
So the read/write divergence is a HOME mismatch, and re-injecting HOME closes it.

### Ruled out (confounded first theories)
- HOME was thought irrelevant, and a "config moved to `~/.claude/.claude.json`" theory looked right --
  BOTH confounded because `CLAUDE_CONFIG_DIR=~/.claude` is set on the dev box (fleet bot scripts export
  it). With CCD set, the CLI reads `$CCD/.claude.json` and ignores HOME, which made HOME look irrelevant
  and made `~/.claude/.claude.json` look like the default. With CCD UNSET (Josh's case), the CLI reads
  `$HOME/.claude.json` and DOES respect HOME. A reviewer caught the confound; re-measuring with CCD
  explicitly unset flipped the answer. Do NOT change the WRITE path to `~/.claude/.claude.json` -- that
  regresses every clean install.

## The fix
`bin/agent-supervisor.sh`: add `HOME` to the pane re-injection loop (one line + comment). The
supervisor's `$HOME` is the plist's `homeDir()` = where `trustFolder` wrote, so the agent now reads the
config Kosmos wrote. Same mechanism/pattern as the `CLAUDE_CONFIG_DIR` re-injection right beside it.
- Safe when `CLAUDE_CONFIG_DIR` IS set (fleet/used machine): the CLI reads `$CLAUDE_CONFIG_DIR/.claude.json`
  and ignores HOME, so the HOME re-injection is a harmless no-op there.

## What finished looks like
- With the fixed supervisor, a default-account agent whose pane HOME is re-injected reads
  `homeDir()/.claude.json` (where trustFolder wrote) -> ZERO trust prompt (proven, test C); without it,
  the prompt fires (control, test D).
- `tools/test-supervisor-env.sh` asserts `HOME=<known>` reaches the pane's `new-session -e` args; all
  supervisor shell tests green. No JS changed.

## Scope / disclosed gaps
- Proven on macOS with the CCD-unset control. Windows uses a different launch path (win32launch.js, no
  shared-tmux-server); this supervisor fix is the macOS launchd/tmux path. If Windows shows the same
  symptom, it's a separate item (flag Homer).
- Also fixes the dead "Trust & Restart" for a default-account agent's next launch (it re-launches through
  the supervisor, which now re-injects HOME).
- 0.6.88 = this fix + the already-merged/verified design work. Money/promote HELD until Josh's laptop
  retest shows a fresh agent comes up with zero trust prompt.
