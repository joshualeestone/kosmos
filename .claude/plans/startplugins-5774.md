# #5774 route 5: config homes elsewhere, and plugin folders named by environment variables

## The gap (the card's route 5, from #5516's stated gaps)
- **Other accounts' config homes.** Another account's config home outside `~/.claude` and `~/.claude-*` (a `CLAUDE_CONFIG_DIR` set elsewhere) is not enumerated, so not covered. The agent's OWN home is covered wherever it is (#5516 review 9).
- **Plugin folders named by environment variables.** Claude Code loads plugins (their hooks and servers run at start) from folders that three variables name, outside every config home: `CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_CODE_PLUGIN_CACHE_DIR` and `CLAUDE_CODE_PLUGIN_SEED_DIR`.

## How Claude Code 2.1.296 reads the variables (measured from its own bundle; details in the private notes)
- All three are read through its environment accessor, which includes the `env` block of every settings tier, as well as the process environment.
- `CLAUDE_CODE_PLUGIN_DIRS`: the value is split on the path delimiter, and each part is trimmed and has a leading `~` expanded (measured: only `~` alone or `~/...`; `~user` is not). Only absolute parts are kept; a relative one is warned about and skipped.
- `CLAUDE_CODE_PLUGIN_CACHE_DIR`: one path with a leading `~` expanded. It replaces `<config home>/plugins` as the plugin cache. A relative value is read from the folder Claude Code runs in, which is the agent's folder.
- `CLAUDE_CODE_PLUGIN_SEED_DIR`: the value is split on the path delimiter, empty parts are dropped, and each part has a leading `~` expanded.

## The change
- The other agents' config homes come from their job files: for each agent folder in the agents' folder, `create.readJob(name).configDir` (Claude agents only). Each one outside `~/.claude*` joins the config homes the guard already covers, for every member it covers.
  - The names come from the agents' folder, not from the job files' names, which carry a world key.
  - It is not read from `create.runningJobs()`, which asks launchd: the guard runs at every refresh.
- `engine/startcommands.js` also returns every value each settings tier gives a variable (not only the agreed ones), with this agent's own tiers and other accounts' homes apart. The three plugin variables are read from this agent's environment, from the home's shell startup files (review 1: the agent's Claude Code inherits the tmux server's environment, which carries shell exports; a value with another variable in it is named), from this agent's own tiers, and from other accounts' homes (absolute values there; a relative one resolves under that account's agent folder, which is not known here, so it is NAMED and the guard fails closed, since review 6). They are parsed as Claude Code parses them. Each folder is denied whole in both layers, links followed, as part 2's folders are. A folder too wide to deny, or one the rules cannot carry, is named.

## Gaps, stated
- The shell startup files read are part 2's zsh and bash rc files by name; part 2's other files (the ~/.bashrc.d folder, the BASH_ENV and ENV files) are not read for the variables (review 7). The files read are part 2's zsh and bash files (the home's and each ZDOTDIR's), on top-level lines only, as part 2 reads its assignments: fish (`set -x`) and nushell syntax, and an export inside an `if` or a function, are not read (review 2).
- A plugin-variable value in a startup file with another variable in it (`$XDG_CACHE_HOME/...`, `$(brew --prefix)/...`) is named, so the guard is not whole: fails closed; the message names the variable and the file to change (review 10).
- A plugin found inside a folder that is REFUSED (too wide, temp, inside the agent) gets its own rule as an installed plugin's folder, which is never pruned (review 10).
- A self-reference other than `$K`, `${K}`, `${K:+$K:}` and `${K:+:$K}` (`${K:-}`, `$K` mid-value) is named: fails closed (review 8).
- The job files are read only when the launch folder is inside the home (production) or an explicit sandbox names it; a caller passing another home with neither (a test) reads no jobs (review 8). That arm is not tested (the tests set the sandbox).
- An agent of ANOTHER named Kosmos (world) shares the agents' folder but its job carries that world's key; readJob(name) reads this world's, so its config home is not found, and nothing names that (review 5; #5516 states the same for its account settings).
- System startup files (/etc/zshenv, /etc/profile) and `launchctl setenv` values are not read for the plugin variables: an administrator's value is not seen (review 5).
- The tmux server's own environment is not read (asking tmux at every refresh is a process per refresh); the shell startup files are, which is where such an export is usually set.
- A hook's `$VAR` is expanded with every tier's agreed value, other accounts' homes included (part 1's rule, kept on purpose: a hook in a home expands with THAT home's env). The job homes add tiers, so a variable two homes set differently makes a hook that uses it named, not whole: fails closed. Expanding each home's hooks with that home's own env is the fix, a change of its own (review 1).
- A plugin folder a variable names is denied by name and, like every guard rule, never pruned: a value that changes (a per-run temp folder, a versioned path, a link whose target moves at an upgrade) leaves its old rule behind (review 3).
- A job's config home is listed whether or not it exists, and like every guard rule it is never pruned; a removed agent's job file goes with it, so only a moved account leaves its old home's rules behind.
- `~\` is expanded on Windows as `~/` is elsewhere; the Windows spelling was not measured in the bundle.
- A config home that no Kosmos job names (a person's own `CLAUDE_CONFIG_DIR` used only outside Kosmos) is not found, nor one whose agent's folder is outside the agents' folder (a connected agent).

## Also in this PR
- The part 2 plan's "route 3" wording for its login-item and PowerShell gaps is corrected in this PR (promised on the card). Shell `source` lines are a gap of route 2, not something route 3 built.

## Tests
engine/startplugins-5774.test.js, 13 tests, using the production job reader against a job file written into a sandboxed launch folder (the platform's own, through test-support/jobfixture.js). Every fix has a mutation that turns its test red; each iteration's note below lists them.

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
- Iteration 3 (Opus), on b3184807a:
  - [WARNING] FIXED (reproduced by the reviewer). The append idiom (`export K="$K:$HOME/x"`, and `${K:+$K:}...`) was named: a false not-whole on a harmless setup. A part that only refers back to the variable is dropped (every earlier value is already gathered and covered). Tested, both spellings; two mutations red.
  - [WARNING] FIXED (reproduced). A backtick command substitution passed silently (only $ was checked). It is now named. Tested; mutation red.
  - [WARNING] FIXED (reproduced). The home folder's ~/.claude/settings.json is ALSO read as a folder-above tier (an agents' folder inside the home), and that entry carried no home, so its relative cache counted as every non-default agent's own. A folder-above tier whose .claude is a config home is now tagged as that home's, by either spelling (the first fix matched the given spelling only, and the /var link hid it: the test went red until both were compared). Tested with an agents' folder inside the home; two mutations red. My earlier test could not see this: its home was not above its agents' folder.
  - [WARNING] STATED under Gaps: variable-named plugin folders are never pruned.
  - [NIT] TAKEN: $HOME is matched with balanced braces only.
  - [NIT] TAKEN: the dead outputs (settingsEnvAll, settingsEnvOwn, settingsEnvOther, the pluginVarDirs export) are removed.
  - [NIT] TAKEN: tests for the 50-home cap and for the per-pass cache being used; two mutations red.
  - [NIT] TAKEN: the job-home test removes its job file, so later tests do not inherit it.
- Iteration 4 (Sonnet), on f7d2f2e08: no BLOCKER.
  - [WARNING] FIXED. `export CLAUDE_CODE_PLUGIN_DIRS="~/plugins"` was named (assignmentsIn reads a quoted ~ as unknown, right for a shell path): the shell keeps it literal and Claude Code expands it, so for these variables a quoted ~ is read. Tested; mutation red.
  - [WARNING] FIXED. The startup files were read again for every agent at every refresh; their values are now read once per pass (the launchCache, as the job homes are). Tested (a seeded cache is used); mutation red.
  - [WARNING] FIXED. The variable-named plugin folders were unbounded; past 50 the rest are named. Tested; mutation red.
  - [WARNING] FIXED. "Another account's home" was decided by spelling only; it now compares real paths too. Through the guard this is masked (the own home joins the home list in the spelling it is passed, so its tier is also read as its own), so it is tested at the scan itself, with the homes in one spelling and the own home in the other; mutation red (it stayed GREEN through the guard first).
  - [NIT] TAKEN: a linked agent folder in the agents' folder is read for its job. Tested; mutation red.
  - [NIT] TAKEN: a job home that is the root or the home itself is named. Tested; mutation red.
  - [NIT] TAKEN: a comment that the cache value is not trimmed, as measured.
  - [NIT] not taken: the startup files are picked from part 2's list by their standard names, which a ZDOTDIR does not change.
- Iteration 5 (Opus), on 433a85a42:
  - [WARNING] FIXED (reproduced by the reviewer). The "holds Kosmos's data" check read deps.dataRoot, which production never passes (every test did), so a plugin folder AT the data root was denied whole in both layers in production. It uses the function's resolved dataRoot. Tested WITHOUT deps.dataRoot, as production calls it; mutation red.
  - [WARNING] FIXED (reproduced). The prepend idiom `${K:+:$K}` (how PATH is usually extended) was named. Both forms are dropped now. Tested; mutation red.
  - [WARNING] STATED under Gaps: another world's agents' config homes are not found.
  - [WARNING] STATED under Gaps: /etc startup files and launchctl setenv values.
  - [NIT] TAKEN: the folder cap counts after the covered check. Tested (51 folders inside a covered folder); mutation red.
  - [NIT] TAKEN: a job home reached by another spelling of one already listed is not added twice.
  - [NIT] TAKEN: a job home that holds this agent's own folder is named. Tested; mutation red.
  - [NIT] TAKEN: each home's real path is resolved once, not per folder above.
  - [NIT] TAKEN (plan): the ~ rule as measured (`~` alone or `~/...`).
- Iteration 6 (Sonnet), on 1f46078da: no BLOCKER.
  - [WARNING] FIXED. The job-home loop resolved real paths per job home per listed home; each is now resolved once (this agent's folder, the home, a set of the listed homes' real paths).
  - [WARNING] FIXED. Another account's RELATIVE cache or seed value was dropped silently (the guard reported whole); it is now named, so the guard fails closed. Tested; mutation red.
  - [WARNING] TAKEN as a comment: a folder the variables name counts as covered for the scan's runners even when the caller then refuses it (too wide, uncarriable, past the cap); every such one is named there, so nothing is silent, but "covered" means denied only for the rest.
  - [WARNING] TAKEN as a comment: on Windows the first pass of a process may ask schtasks once per agent (readJob reads through win32job's cache); once per pass after that.
  - [NIT] TAKEN: the Tests section no longer carries a stale mutation count.
  - [NIT] not taken: a single-quoted `$HOME/x` is named as "a quoted value" (rare; fails closed).
  - [NIT] not taken: the temp folder compared is os.tmpdir() (or the injected one); the shell's own temp folder is the same on this fleet.
- Iteration 7 (Opus), on a886914a1:
  - [WARNING] FIXED (reproduced by the reviewer). The plugins INSIDE the folders the variables name were never parsed: a dev plugin's hooks.json running a script outside its folder was a silent miss, and a cache folder's installed_plugins.json and known_marketplaces.json (it takes the place of <home>/plugins) were not read. A CLAUDE_CODE_PLUGIN_DIRS entry is now parsed as a plugin root, and a cache or seed folder is read as a plugin folder. Tested (a dev plugin's hook script and a cached plugin's hook script and folder denied); two mutations red. MY FIRST CUT added the roots to the installed plugins' list, which returned them as installed plugin folders: denied by that loop, with none of the variable folders' checks (the cap, the data folder, inside the agent), so two earlier tests went red. They are now tagged, parsed for their commands only, and denied by the variable loop alone; mutation red (four tests).
  - [WARNING] FIXED (reproduced). A job home already listed (the agent's own, coming back through its own job) was re-judged by refusals it never went through, so an own home holding the agent's folder was named at refresh. The listed check now comes first. Tested; mutation red.
  - [WARNING] FIXED. A variable-named folder INSIDE the agent's own folder was denied whole, unlike an installed plugin there (named). Same policy now: named. Tested; mutation red (two tests).
  - [WARNING] FIXED: the stale comment that other agents' homes are a stated gap.
  - [NIT] TAKEN: positive arms for the other-account relative cache (it is named) and the cap test (the folders were seen).
  - [NIT] STATED under Gaps: part 2's .bashrc.d and BASH_ENV/ENV files are not read for the variables.
  - [NIT] not taken (design note): another account's relative cache could be resolved under each agent the job homes say run on it; it is named instead (fails closed).
  - [NIT] not taken: an uncarriable job home spends one of the 50 places (harmless at today's sizes).
- Iteration 8 (Sonnet), on 75587de67: no BLOCKER.
  - [WARNING] FIXED. Tests that pass a home but no workers root read the machine's REAL agents' folder, and through readJob the real jobs, adding real config homes to their rules. The job files are now read only when the launch folder is inside the home or an explicit sandbox names it. Mutation (jobs never read): red, four tests.
  - [WARNING] FIXED. The startup-file cache was keyed by the home alone; it is keyed by the files read (they follow ZDOTDIR and the agent). Its test now proves reuse with two agents in one pass and the file changed between them.
  - [WARNING] STATED under Gaps: other self-reference spellings are named (fail closed).
  - [WARNING] NOT A DEFECT: the cache value is not trimmed because 2.1.296 does not trim it (measured; a comment says so).
  - [WARNING] FIXED in part. A plugin folder inside the temp folder (a per-run place, whose rule would pile up at every refresh, never pruned) is named, not denied. The test file now passes a temp folder of its own (its sandbox lives inside the real one). Tested; mutation red. Cross-pass growth of stable values stays under the pruning gap.
  - [WARNING] FIXED. A job home holding this agent's folder was refused, so one odd job file stopped every agent's creation. It is now refused only when a member it denies whole (its code and memory folders) would hold the agent's folder or sit inside it. Tested both ways; two mutations red (the old broad rule and no rule).
  - [NIT] TAKEN: the repeated checks in the job-home loop are gone; the startup-file size limit is a named constant.
  - [NIT] not taken: the "Review N" notes in comments are this codebase's convention.
- Iteration 9 (Opus), on 7beae4a22:
  - [WARNING] FIXED (reproduced by the reviewer). A plugin installed INSIDE a cache folder (<cache>/cache/<marketplace>/<plugin>/<version>) got its own versioned rule, which piles up at every update: the installed-plugin loop ran before the cache folder was denied whole. It runs after now, so the cache folder covers it; a refused folder covers nothing. Tested; the old order turns it red. My edit first REMOVED the folder cap without re-adding it (an anchor joined two lines); the cap test caught it, and the cap is back after the refusals.
  - [WARNING] FIXED. The review-7 "listed home first" test could not fail (the wording changed in review 8, and the agent was not under a code member). It now places the agent under its own home's skills/ so only the early skip keeps it from being named; mutation red.
  - [NIT] TAKEN: the folder cap counts after the refusals.
  - [NIT] TAKEN: an unquoted ~user in a startup file (the shell's to expand) is named. Tested; mutation red.
  - [NIT] TAKEN: a comment on jobsHere (it asks whether the caller's home is the machine's).
  - [NIT] TAKEN (plan): another account's relative value is named, not just uncounted.
  - [NIT] not taken: CLAUDE_PLUGIN_DATA for a cached plugin points under the agent's home; both that folder and the cache are denied whole, so nothing is missed.
  - [NIT] ALREADY covered: the review-8 holder test has its positive arm (the holding home's settings.json is denied).
- Iteration 10 (Sonnet), on bf5078baf: no BLOCKER.
  - [WARNING] FIXED. A job file that exists but cannot be read folded into "no job" (readJob), a silent loss of that agent's config home. readJobVerdict's reason is now used (Linux, Windows), and on macOS, whose reader says only job-or-null, a job file that is there yet reads as no job is named. Tested (a folder where the job file should be); two mutations red.
  - [WARNING] FIXED. A relative configDir in a job was dropped silently; it is named. Tested; mutation red.
  - [WARNING] STATED under Gaps: another variable in a startup-file value fails closed.
  - [NIT] TAKEN: a cache folder that is a home's own plugins folder is read once.
  - [NIT] TAKEN: the coveredDirs comment says "covered or named".
  - [NIT] STATED under Gaps: plugins inside a refused folder get their own rules.

