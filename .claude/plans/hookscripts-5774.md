# hookscripts-5774: the token-only guard covers the scripts start-time commands run (kosmos#5774 part 1)

## Why
#5516 part 2 denied the configuration Claude Code reads at a token-only agent's start. A command in that configuration can still name a script anywhere else on the computer: a hook, the status line, an auth helper, or a server's program file. The script runs outside the sandbox each time the command does, so if the agent's file tools can rewrite it, the guard is open through it. Of the routes #5516 left for a next part, this one was picked first because it is live on a real install (measured; the details are in private notes, as for #5122), and because such a script runs during the session, on every hook, not only at the next start.

## The change
- `engine/startcommands.js` (new): reads every command Claude Code will run for the agent and names the script files they point at. Sources, read from Claude Code 2.1.296: each config home's settings, local settings and remote settings; the agent folder's and each folder above's `.claude` settings and `.mcp.json`; each global config's own servers and its entries for the agent folder and the folders above (never other projects'); the managed settings, their drop-in folder and the managed server file; and each installed plugin's manifest, hooks, servers and language servers. Commands are an object's `command` (with a server's `args`), and the helper keys (`apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `gcpAuthRefresh`, `otelHeadersHelper`, `proxyAuthHelper`, `headersHelper`, any later `...Helper`). Each command is split into words as a shell would, enough to find paths: quotes, known variables (`HOME`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CONFIG_DIR` for the agent's own home, `CLAUDE_PLUGIN_ROOT` in a plugin), `~`, command substitution, operators, and the script after a shell's `-c`.
- `engine/setup-assistant.js` `tokenOnlySettingsRules`: the scripts found are denied in both layers, links followed, as the start-time config files are. A script inside a folder already denied whole is left to that rule. An installed plugin's folder outside the config homes is denied whole. A command whose script path is built when it runs is named, and the guard says it is not whole. A script path the rules cannot carry is named when it exists.
- `engine/hookscripts-5774.test.js`: every tier, both layers; controls; the not-whole cases; the splitter.

## Decided
- **Every config home, not only the agent's own:** Kosmos can move an agent to another account (failover), and the guard already covers every home the same way.
- **Redirection targets are skipped** (`>> notes.md`): written by the command, not run. Denying them would lock the agent out of its own files when a hook appends to one. Input redirection (`bash < x.sh`) is kept: that is what runs.
- **A bare program word** (`bash`, `node`) is found on PATH, which #5516 part 1 covers. A bare later word counts only when it is a file in the agent folder.
- **A dynamic path makes the guard not whole** (as an uncarriable link target already does in #5516). Rejected: guessing, or skipping silently. What would change it: such hooks turning out common on real installs. Measured on the fleet Mac: none.
- **An uncarriable path that does not exist is skipped:** a word that only looks like a path (a sed expression such as `s/(a)/b/`) is far likelier than a missing script with brackets in its name, and naming it would refuse token-only agents for nothing.
- **Global config: own servers and the agent's project entries only.** That file holds every project on the computer, and others' servers do not start for this agent.
- **Over-denial is the safe direction:** a word with a slash that is not a script (a `tee` target, an echo argument) is denied to the agent's tools. That costs profile size, which the existing size warning counts.

## Gaps, stated
- What a script runs or reads in turn (a script that sources another): a next part of #5774.
- The shell's own startup files, and environment settings that point a program at code (BASH_ENV, NODE_OPTIONS): a next part.
- Hooks declared inside skills, agents and commands: those definitions are denied whole where they live, but a script they name elsewhere is not read. A next part.
- A plugin loaded from a folder given on the command line, or from a skill folder, is not in the installed-plugins record.
- A script named by a later edit to a config file the agent cannot edit (the person's, or Kosmos's) is covered at the next guard refresh, not at once.
- The splitter is not a shell: aliases, functions, `eval`, and words built by shell expansions other than `$VAR`, `${VAR}` and `$(...)` are not read.
- Tests elsewhere that do not pass `managedDir` read the real managed folder (absent on the fleet Macs).

## Weakest premise
That the commands Claude Code runs are the ones these keys hold. The list is read from 2.1.296's settings schema and loaders; a later version with a new command-carrying key is a gap until added, though any `...Helper` key is read already.

## Challenge loop notes
