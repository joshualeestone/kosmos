# #5774 route 5: config homes elsewhere, and plugin folders named by environment variables

## The gap (the card's route 5, from #5516's stated gaps)
- **Other accounts' config homes.** Another account's config home outside `~/.claude` and `~/.claude-*` (a `CLAUDE_CONFIG_DIR` set elsewhere) is not enumerated, so not covered. The agent's OWN home is covered wherever it is (#5516 review 9).
- **Plugin folders named by environment variables.** Claude Code loads plugins (their hooks and servers run at start) from folders that three variables name, outside every config home: `CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_CODE_PLUGIN_CACHE_DIR` and `CLAUDE_CODE_PLUGIN_SEED_DIR`.

## How Claude Code 2.1.296 reads the variables (measured from its own bundle; details in the private notes)
- All three are read through its environment accessor, which includes the `env` block of every settings tier, as well as the process environment.
- `CLAUDE_CODE_PLUGIN_DIRS`: the value is split on the path delimiter, and each part is trimmed and has a leading `~` expanded. Only absolute parts are kept; a relative one is warned about and skipped.
- `CLAUDE_CODE_PLUGIN_CACHE_DIR`: one path with a leading `~` expanded. It replaces `<config home>/plugins` as the plugin cache. A relative value is read from the folder Claude Code runs in, which is the agent's folder.
- `CLAUDE_CODE_PLUGIN_SEED_DIR`: the value is split on the path delimiter, empty parts are dropped, and each part has a leading `~` expanded.

## The change
- The other agents' config homes come from their job files: for each agent folder in the agents' folder, `create.readJob(name).configDir` (Claude agents only). Each one outside `~/.claude*` joins the config homes the guard already covers, for every member it covers.
  - The names come from the agents' folder, not from the job files' names, which carry a world key.
  - It is not read from `create.runningJobs()`, which asks launchd: the guard runs at every refresh.
- `engine/startcommands.js` also returns every value each settings tier gives a variable (not only the agreed ones), with this agent's own tiers and other accounts' homes apart. The three plugin variables are read from this agent's environment, from the home's shell startup files (review 1: the agent's Claude Code inherits the tmux server's environment, which carries shell exports; a value with another variable in it is named), from this agent's own tiers, and from other accounts' homes (absolute values only there: a relative one resolves under that account's agent folder, which is not known here). They are parsed as Claude Code parses them. Each folder is denied whole in both layers, links followed, as part 2's folders are. A folder too wide to deny, or one the rules cannot carry, is named.

## Gaps, stated
- The shell startup files read are part 2's zsh and bash files (the home's and each ZDOTDIR's), on top-level lines only, as part 2 reads its assignments: fish (`set -x`) and nushell syntax, and an export inside an `if` or a function, are not read (review 2).
- The tmux server's own environment is not read (asking tmux at every refresh is a process per refresh); the shell startup files are, which is where such an export is usually set.
- A hook's `$VAR` is expanded with every tier's agreed value, other accounts' homes included (part 1's rule, kept on purpose: a hook in a home expands with THAT home's env). The job homes add tiers, so a variable two homes set differently makes a hook that uses it named, not whole: fails closed. Expanding each home's hooks with that home's own env is the fix, a change of its own (review 1).
- A job's config home is listed whether or not it exists, and like every guard rule it is never pruned; a removed agent's job file goes with it, so only a moved account leaves its old home's rules behind.
- `~\` is expanded on Windows as `~/` is elsewhere; the Windows spelling was not measured in the bundle.
- A config home that no Kosmos job names (a person's own `CLAUDE_CONFIG_DIR` used only outside Kosmos) is not found, nor one whose agent's folder is outside the agents' folder (a connected agent).

## Also in this PR
- The part 2 plan's "route 3" wording for its login-item and PowerShell gaps is corrected in this PR (promised on the card). Shell `source` lines are a gap of route 2, not something route 3 built.

## Tests
engine/startplugins-5774.test.js, 6 tests, using the production job reader against a job file written into a sandboxed launch folder. Nine mutations, each red:
- each of the three variables dropped;
- a relative CLAUDE_CODE_PLUGIN_DIRS part kept;
- no ~ expansion;
- the environment only (no settings tiers);
- only the tiers' agreed value;
- a too-wide folder denied;
- the job homes dropped.

## Challenge loop notes
- Iteration 1 (Opus), on b7d167941:
  - [WARNING] FIXED in part, the rest stated. The variables were read from the board's environment, but the agent's Claude Code inherits the tmux server's, which carries shell exports: the home's startup files are now read for them (a value with another variable in it is named). The tmux server's own environment is a stated gap. Tested (a startup-file export denied, an unknown value named); two mutations red. The first startup-file mutation did not apply (its anchor matched part 2's identical loop too); re-anchored, red.
  - [WARNING] FIXED. The job-file test wrote a plist, which Linux's job reader never reads: it would have gone red on the Linux CI. It uses test-support/jobfixture.js and sets AGENT_WORKFORCE_SYSTEMD_DIR.
  - [WARNING] FIXED in part. Other accounts' homes fed this agent's plugin-variable values: a relative cache or seed from another home was resolved under THIS agent's folder. Other homes' values are now kept apart and only their absolute ones count. Tested; two mutations red. NOT taken, decided: the hooks' agreed values from every tier. I first narrowed them to this agent's tiers; part 1's own test showed why that is wrong (a hook in a home expands with that home's env, so this agent's agreed value could be the wrong one, a silent miss). Reverted; stated under Gaps as fail-closed.
  - [NIT] TAKEN. "Too wide" also covers a folder holding the temp folder or Kosmos's data (a sandbox deny there would quietly break the shell). Tested with an injected temp folder (deps.tmpDir): the test's real temp folder holds its home, so the first mutation stayed GREEN, named by the home check; now red.
  - [NIT] TAKEN. `~\` on Windows (stated as unmeasured).
  - [NIT] TAKEN. The wording for a job home the rules cannot carry ("a config home an agent's job names", which may be the agent's own).
  - [NIT] TAKEN. An agents' folder that cannot be read is named. Tested; mutation red.
  - [NIT] STATED under Gaps: a job home is listed whether or not it exists.
  - [NIT] TAKEN: tests for the runner filter (a codex job's home is not a Claude config home), an uncarriable job home, and a linked plugin folder (its target in both layers). Two mutations red.
- Iteration 2 (Sonnet), on 5ae061684 (rebased onto main after #5837):
  - [WARNING] FIXED. `export CLAUDE_CODE_PLUGIN_DIRS="$HOME/a:$HOME/b"` kept the second $HOME and was named: a false not-whole. $HOME is now replaced at the start of each delimiter-separated part. Tested; mutation red.
  - [WARNING] FIXED. The plugin folders the variables name were counted as covered only AFTER the start-command scan judged its folder runners, so a package runner inside such a folder (a dev plugin checkout's node_modules/.bin tool named by a hook) was named: a false not-whole. The variables are now gathered first (environment and startup files) and parsed inside the scan (startcommands.pluginVarDirs) with the settings tiers' values, and those folders are covered for its runners. Tested; mutation red.
  - [WARNING] FIXED. The job homes were read once per agent per refresh (N agents, N job files each). They are read once per pass, kept in the pass's launchCache (both the board-start refresh and the per-tick check pass one). Past 50 homes outside ~/.claude* the rest are named (each adds its members to the profile).
  - [WARNING] FIXED. A failure reading the job homes is named, not swallowed.
  - [WARNING] STATED under Gaps: fish and nushell syntax, and indented or conditional exports. The startup files are now part 2's own list (the home's and each ZDOTDIR's zsh and bash files), so the two cannot drift.
  - [NIT] TAKEN: a file is checked for the variable's name before it is parsed.
  - [NIT] TAKEN: a plugin folder that is or holds a config home (which Claude Code writes) is too wide. Tested; mutation red.
  - [NIT] TAKEN: a relative job configDir is skipped.
  - [NIT] not taken: ownHome. When it is not passed the agent is on the default account, whose home is ~/.claude (the fallback).
  - [NIT] not taken: the $ check after assignmentsIn rejects single-quoted values is a harmless double filter.

