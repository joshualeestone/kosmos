# configstart-5516: the token-only guard covers Claude Code's own start-time config (kosmos#5516 part 2)

## Why
Part 1 (#5660) denied the programs a token-only agent's next start runs from its launch path. This part covers the next class on the card: configuration Claude Code itself reads at start that names programs to run outside the sandbox. A token-only agent must not be able to arrange such a program through its own file tools or shell.

## The change
- `engine/setup-assistant.js` `tokenOnlySettingsRules`: the guard's denies, in both layers (the file tools' Edit rules and the sandbox's denyWrite), now also cover the start-time config files Claude Code reads for servers it starts, in every account config home and in the agent's folder, and each config home's plugin folder. A glob covers a config home made later, in the permission layer, as the guard already does for settings files.
- `engine/configstart-5516.test.js`: both layers name each one; a control that the config homes themselves are still not denied whole.

## Decided
- **Deny, not clean.** The earlier idea was to strip entries from these files at each board start. These files are shared by the person and every agent on the account, so cleaning would delete the person's own entries. Measured instead: Claude Code still writes its own state to these files with both layers denying them, because its own process is in neither layer. So the deny takes nothing from Claude Code and nothing from the person.
- Kosmos writes none of these for a Claude agent (searched), so nothing Kosmos does is refused.

## Gaps, stated (the rest of the card)
- The scripts a hook, the status line or a server's command points at, wherever they sit: not covered here (they can live anywhere; a next part).
- Shell startup files, what start-time files pull in, and links the agent makes itself: later parts of the card, as listed there.

## Weakest premise
That Claude Code never writes these files through a sandboxed subprocess or through its own tools on the agent's behalf. Measured for its state writes at start (one version, 2.1.296); a plugin install or update run by the person is their own process. If a future version moves those writes into a sandboxed subprocess, plugin installs on that account would fail while a token-only agent is guarded, and the guard would need a narrower rule.
