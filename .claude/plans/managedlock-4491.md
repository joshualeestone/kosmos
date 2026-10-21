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
`{"sandbox":{"filesystem":{"denyRead":["~/Library/Application Support/Kosmos/board.token"]}}}`, as its own drop-in,
`/Library/Application Support/ClaudeCode/managed-settings.d/kosmos-token-guard.json` (Claude Code 2.1.306 loads and
merges every file there), so the base managed-settings.json is never edited and --uninstall removes one file.
- **Why this closes the hole.** Claude Code's docs (sandboxing, "Which settings can disable it"): user settings may set
  `sandbox.filesystem.disabled`; project settings may not; and once MANAGED settings configure `sandbox.filesystem` at
  all, only managed settings may. The 10-02 hole was exactly a planted `~/.claude/settings.json`.
  The single denyRead entry is what makes the block non-empty.
- **Why not sandbox.enabled or allowUnsandboxedCommands.** Managed settings reach every Claude Code session on the
  Mac (docs: no per-project scope). Either key would sandbox the fleet's builders. The agent's PROJECT settings set
  both already, and project settings outrank user settings, so a planted user file cannot undo them.
- **Why the deny list need not be complete.** The agent's project settings deny every token root concretely. The
  managed entry exists so the block is non-empty; it does not need to replace that list.

## Review round 1 (2026-10-21), and what changed
- `allowManagedReadPathsOnly` DROPPED: the installed Claude Code 2.1.306 itself warns it "would drop the sandbox's own
  directories from the readable set". A denyRead entry alone makes the block non-empty, which is what locks `disabled`.
- A drop-in instead of merging into managed-settings.json: uninstall restoring or deleting the whole file lost anything
  added after install. Now no merge, no kept copy; uninstall removes only our file.
- Refuses when a managed file already sets `sandbox.filesystem.disabled: true` (read-denies would not be enforced, and
  it would have said "installed").
- Refuses to write through a link, or into an existing folder root does not own; sets owner and mode only on folders
  it created; the temp file is made with mktemp inside the drop-in folder.
- engine: managedSettingsPresent and the #5668 deny-size count see the drop-in too.

## Review round 2
- One SHOULD: boardkeychain-4491.test.js read the real /Library paths, so installing the drop-in on a dev Mac (this
  card's own next step) would turn it red. managedSettingsPresent takes the paths (refreshTokenOnlyGuards passes
  deps.managedPaths); the test passes a missing one, and a new arm shows a given present file counts.

## Rejected
- `allowManagedReadPathsOnly` (see review round 1).
- A managed `permissions.deny` on `Edit(~/.claude/settings.json)`: it would block every agent's Write tool on that
  file, including the fleet's own setup skills.
- Option A (Keychain): dropped on 10-12, measured (trust follows the code; a dialog on the person's screen).
- node for the JSON merge: the installer runs as root, so only `/usr/bin/plutil` touches the file.

## Weakest premise
- That a `sandbox.filesystem` block arriving through a managed-settings.d drop-in counts as "managed settings configure
  sandbox.filesystem" for the lock, as one in managed-settings.json would. The docs say drop-ins merge into the managed
  tier, and 2.1.306's loader merges them; the lock through a drop-in is still to be measured at the first install.
- The lock is documented, not measured. Measuring it needs root (the managed path is under /Library), which no agent
  has. The first install is that measurement: a planted user `sandbox.filesystem.disabled` must stop working for the
  token-only agent, and builders must notice nothing.
- That a managed `denyRead` is inert for sessions whose sandbox is off. The docs imply it (the sandbox enforces the
  list) but do not say it.

## What would change my mind
- After install, a builder seeing any new refusal: uninstall (one command) and narrow.
- The lock not holding in measurement: then the managed file needs `sandbox.enabled`, and that becomes a fleet-wide
  decision for Josh, not a builder's call.
