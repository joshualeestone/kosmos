# managedlock-4491: the managed-settings lock, built and ready for the one admin step

Card: joshualeestone/kosmos#4491. What was left (item 2): a root-owned Claude Code managed-settings file that makes
the token-only guard durable. Splinter, 2026-10-21 03:30: decide whatever is reversible and build it; keep
needs-operator only for a named step.

## Finished looks like
- The content of the managed file is decided and written down with its reasons.
- `tools/managed-sandbox-lock.sh` shows (default) exactly what it would write, installs it with `sudo` in one command,
  and undoes it in one command. Tested through a seam without root.
- The card names the single remaining step: someone with the Mac admin password runs `--install` on one Mac; then
  the guard is measured there.

## The call: what goes in the file
`{"sandbox":{"filesystem":{"allowManagedReadPathsOnly":true,"denyRead":["~/Library/Application Support/Kosmos/board.token"]}}}`
merged into any managed file already there.
- **Why this closes the hole.** Claude Code's docs (sandboxing, "Which settings can disable it"): user settings may set
  `sandbox.filesystem.disabled`; project settings may not; and once MANAGED settings configure `sandbox.filesystem` at
  all, only managed settings may. The 10-02 hole was exactly a planted `~/.claude/settings.json`.
  `allowManagedReadPathsOnly` stops a lower tier re-opening a read path (an `allowRead` over the token). The token-only
  agent's own settings already strip allowRead/allowWrite, so nothing it relies on is lost.
- **Why not sandbox.enabled or allowUnsandboxedCommands.** Managed settings reach every Claude Code session on the
  Mac (docs: no per-project scope). Either key would sandbox the fleet's builders. The agent's PROJECT settings set
  both already, and project settings outrank user settings, so a planted user file cannot undo them.
- **Why the deny list need not be complete.** The agent's project settings deny every token root concretely. The
  managed entry exists so the block is non-empty; it does not need to replace that list.

## Rejected
- A managed `permissions.deny` on `Edit(~/.claude/settings.json)`: it would block every agent's Write tool on that
  file, including the fleet's own setup skills.
- Option A (Keychain): dropped on 10-12, measured (trust follows the code; a dialog on the person's screen).
- node for the JSON merge: the installer runs as root, so only `/usr/bin/plutil` touches the file.

## Weakest premise
- The lock is documented, not measured. Measuring it needs root (the managed path is under /Library), which no agent
  has. The first install is that measurement: a planted user `sandbox.filesystem.disabled` must stop working for the
  token-only agent, and builders must notice nothing.
- That a managed `denyRead` is inert for sessions whose sandbox is off. The docs imply it (the sandbox enforces the
  list) but do not say it.

## What would change my mind
- After install, a builder seeing any new refusal: uninstall (one command) and narrow.
- The lock not holding in measurement: then the managed file needs `sandbox.enabled`, and that becomes a fleet-wide
  decision for Josh, not a builder's call.
