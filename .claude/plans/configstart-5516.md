# configstart-5516: the token-only guard covers Claude Code's own start-time config (kosmos#5516 part 2)

## Why
Part 1 (#5660) denied the programs a token-only agent's next start runs from its launch path. This part covers the next class on the card: configuration Claude Code itself reads at start that names programs to run outside the sandbox. A token-only agent must not be able to arrange such a program through its own file tools or shell.

## The change
- `engine/setup-assistant.js` `tokenOnlySettingsRules`: the guard's denies, in both layers (the file tools' Edit rules and the sandbox's denyWrite), now also cover the start-time config files Claude Code reads for servers it starts, in every account config home and in the agent's folder, and each config home's plugin folder. A glob covers a config home made later, in the permission layer, as the guard already does for settings files.
- `engine/configstart-5516.test.js`: both layers name each one; a control that the config homes themselves are still not denied whole.

## Decided
- **Deny, not clean.** The earlier idea was to strip entries from these files at each board start. These files are shared by the person and every agent on the account, so cleaning would delete the person's own entries. Measured instead: Claude Code still writes its own state to these files with both layers denying them, because its own process is in neither layer. So the deny takes nothing from Claude Code and nothing from the person.
- Kosmos writes none of these for a Claude agent (searched), so nothing Kosmos does is refused.
- Review 1 widened the class, each member read from the installed Claude Code: the global config by every name it is given (an environment suffix), the legacy file it reads instead when present, the project server file in the agent folder and every folder above it, and each config home's skills folder (a skills subfolder can be adopted as a plugin). The test pins each member.
- The file-tool layer carries the weight: the shell's own writable set already excludes most of these. The sandbox entries are defence in depth.
- Review 2: the config homes' agents and commands folders join plugins and skills (their definitions can carry hooks and servers). The ancestors' project server files go to the file tools only, since the shell cannot write there and the sandbox profile has a size limit; a test keeps the guard whole with twelve config homes.
- What is asserted and what was measured by hand: the tests assert the rules written. That Claude Code still writes its own state under these denies was measured by hand (one version); the class itself is read from the installed binary, so a later Claude Code that reads a new file is a gap until added.

- Review 3: the agent's own .claude is now denied whole to the file tools; it had only the three named files there, so its project agents, commands, skills and workflows were open to its Write and Edit tools. Got wrong: my comment said they were "already denied", true only of the sandbox layer, in the same change that calls the file-tool layer the load-bearing one. The config homes' members widen to every code or instruction member of Claude Code's own protected list (not its runtime state), and a member that is a link has its target named in both layers. Ancestors are walked by both the given and the resolved path.

- Review 4: denying the agent's whole .claude to its tools also refused its plans and worktrees there, so only the code and instruction members are denied (the config-home list); the shell layer still denies the folder whole, as before. The instruction files above the agent folder join its server file there (file tools only), for the reason the config home's CLAUDE.md is in: they reach every agent below. The agent's own CLAUDE.md is out: it reaches only itself, and Kosmos writes it.

## Gaps, stated (the rest of the card)
- A plugin folder Claude Code is pointed at by its plugin cache or seed environment variables, outside every config home: not covered (same shape as the CLAUDE_CONFIG_DIR gap).
- A project-scope language-server file: named in the binary, not confirmed to be read from the project folder; not denied.
- A link the agent itself makes later (a new link in a config home or above its folder): its target is not followed until the next guard refresh.
- A config home Claude Code is pointed at outside ~/.claude and ~/.claude-* (CLAUDE_CONFIG_DIR elsewhere): not enumerated, so not covered. Kosmos's own accounts live in ~/.claude-<label>.
- The resolved-path walk of the ancestors is not exercised by a test (the test folders' parents are not links).
- The scripts a hook, the status line or a server's command points at, wherever they sit: not covered here (they can live anywhere; a next part).
- Shell startup files, what start-time files pull in, and links the agent makes itself: later parts of the card, as listed there.

## Weakest premise
That Claude Code never writes these files through a sandboxed subprocess or through its own tools on the agent's behalf. Measured for its state writes at start (one version, 2.1.296); a plugin install or update run by the person is their own process. If a future version moves those writes into a sandboxed subprocess, plugin installs on that account would fail while a token-only agent is guarded, and the guard would need a narrower rule.
