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
- `engine/startcommands.js` also returns every value each settings tier gives a variable (not only the agreed ones). The three plugin variables are read from that and from the agent's environment, and parsed as Claude Code parses them. Each folder is denied whole in both layers, links followed, as part 2's folders are. A folder too wide to deny, or one the rules cannot carry, is named.

## Gaps, stated
- A config home that no Kosmos job names (a person's own `CLAUDE_CONFIG_DIR` used only outside Kosmos) is not found, nor one whose agent's folder is outside the agents' folder (a connected agent).

## Also in this PR
- The part 2 plan's "route 3" wording for its login-item and PowerShell gaps is corrected in this PR (promised on the card). Shell `source` lines are a gap of route 2, not something route 3 built.

## Tests
engine/startplugins-5774.test.js, 3 tests, using the production job reader against a job file written into a sandboxed launch folder. Nine mutations, each red:
- each of the three variables dropped;
- a relative CLAUDE_CODE_PLUGIN_DIRS part kept;
- no ~ expansion;
- the environment only (no settings tiers);
- only the tiers' agreed value;
- a too-wide folder denied;
- the job homes dropped.

## Challenge loop notes
